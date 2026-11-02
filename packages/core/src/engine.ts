import { CircuitBreaker } from "./circuit-breaker.js";
import { systemClock } from "./clock.js";
import { nominalLimit, validateStrategyConfig } from "./config.js";
import { RateLimitConfigError } from "./errors.js";
import { buildHeaders } from "./headers.js";
import { matchRule } from "./matcher.js";
import { DefaultMetricsCollector } from "./metrics.js";
import { buildKey } from "./namespace.js";
import { byIp } from "./resolvers.js";
import type {
  Clock,
  ConsumeResult,
  CostResolver,
  Decision,
  HeaderOptions,
  KeyResolver,
  MetricsCollector,
  MetricsEvent,
  OnStoreError,
  RateLimitContext,
  RateLimiterOptions,
  Rule,
  Store,
  StrategyConfig,
} from "./types.js";

const DEFAULT_BREAKER = { threshold: 5, cooldownMs: 5000 };

/** The framework-agnostic rate limiter. Adapters call `check(ctx)`. */
export class RateLimiter {
  private readonly store: Store;
  private readonly fallbackStore: Store | undefined;
  private readonly keyPrefix: string;
  private readonly defaults: StrategyConfig;
  private readonly rules: readonly Rule[];
  private readonly keyResolver: KeyResolver;
  private readonly onStoreError: OnStoreError;
  private readonly clock: Clock;
  private readonly costFn: CostResolver;
  private readonly metrics: MetricsCollector | undefined;
  private readonly breaker: CircuitBreaker | undefined;
  readonly headerOptions: HeaderOptions;

  constructor(options: RateLimiterOptions) {
    if (!options || typeof options !== "object") {
      throw new RateLimitConfigError("RateLimiter options are required.");
    }
    if (!options.store) {
      throw new RateLimitConfigError("A `store` is required.");
    }
    if (!options.defaults) {
      throw new RateLimitConfigError("A `defaults` strategy config is required.");
    }
    validateStrategyConfig(options.defaults);
    for (const rule of options.rules ?? []) {
      validateStrategyConfig(rule);
      if (!rule.match || typeof rule.match !== "object") {
        throw new RateLimitConfigError("Each rule requires a `match` object.");
      }
    }
    if (options.onStoreError === "local-fallback" && !options.fallbackStore) {
      throw new RateLimitConfigError(
        "onStoreError 'local-fallback' requires a `fallbackStore`.",
      );
    }

    this.store = options.store;
    this.fallbackStore = options.fallbackStore;
    this.keyPrefix = options.keyPrefix ?? "default";
    this.defaults = options.defaults;
    this.rules = options.rules ?? [];
    this.keyResolver = options.keyResolver ?? byIp;
    this.onStoreError = options.onStoreError ?? "fail-open";
    this.clock = options.clock ?? systemClock;
    this.costFn = options.cost ?? (() => 1);
    this.metrics =
      options.metrics === false
        ? undefined
        : (options.metrics ?? new DefaultMetricsCollector({ clock: this.clock }));
    this.breaker =
      options.circuitBreaker === false
        ? undefined
        : new CircuitBreaker(
            (options.circuitBreaker ?? DEFAULT_BREAKER).threshold,
            (options.circuitBreaker ?? DEFAULT_BREAKER).cooldownMs,
          );
    this.headerOptions = options.headers ?? { standard: true, legacy: false };
  }

  /** The metrics collector, if enabled (for exporters/dashboard). */
  getMetrics(): MetricsCollector | undefined {
    return this.metrics;
  }

  /** Build response headers for a decision using this limiter's header config. */
  headersFor(decision: Decision): Record<string, string> {
    return buildHeaders(decision, this.headerOptions);
  }

  /** Evaluate a single request. Never throws for store failures (degrades). */
  async check(ctx: RateLimitContext): Promise<Decision> {
    const receivedAt = this.clock.now();

    const rule = this.rules.length ? matchRule(this.rules, ctx) : undefined;
    const config: StrategyConfig = rule ?? this.defaults;
    const resolver = rule?.keyResolver ?? this.keyResolver;
    const onErr = rule?.onStoreError ?? this.onStoreError;

    const partition = await resolver(ctx);
    const key = buildKey(this.keyPrefix, config.strategy, partition);
    const cost = this.costFn(ctx);
    const limit = nominalLimit(config);

    let result: ConsumeResult;
    let degraded = false;

    const breakerOpen = this.breaker
      ? !this.breaker.canRequest(receivedAt)
      : false;

    if (breakerOpen) {
      ({ result, degraded } = await this.degrade(onErr, {
        config,
        key,
        cost,
        now: receivedAt,
        limit,
      }));
    } else {
      try {
        result = await this.store.consume({ key, config, cost, now: receivedAt });
        this.breaker?.recordSuccess();
      } catch {
        this.metrics?.recordStoreError();
        this.breaker?.recordFailure(this.clock.now());
        ({ result, degraded } = await this.degrade(onErr, {
          config,
          key,
          cost,
          now: receivedAt,
          limit,
        }));
      }
    }

    const decidedAt = this.clock.now();
    const decision: Decision = {
      allowed: result.allowed,
      limit: result.limit,
      remaining: result.remaining,
      resetMs: result.resetMs,
      ...(result.retryAfterMs !== undefined
        ? { retryAfterMs: result.retryAfterMs }
        : {}),
      strategy: config.strategy,
      key,
      degraded,
      receivedAt,
      decidedAt,
      evaluationMs: decidedAt - receivedAt,
    };

    if (this.metrics) {
      const event: MetricsEvent = {
        decision,
        route: `${ctx.method} ${ctx.path}`,
        ...(ctx.tenant !== undefined ? { tenant: ctx.tenant } : {}),
      };
      try {
        this.metrics.record(event);
      } catch {
        // Metrics must never break a request.
      }
    }

    return decision;
  }

  /** Reset a partition's state by its fully namespaced key (admin/dashboard). */
  async resetByKey(key: string): Promise<void> {
    await this.store.reset?.(key);
  }

  /** Non-mutating read of a key's current state (admin/dashboard). */
  async peekByKey(key: string): Promise<ConsumeResult | null> {
    return (await this.store.peek?.(key)) ?? null;
  }

  /** Primary store health. */
  async health(): Promise<boolean> {
    try {
      return await this.store.healthcheck();
    } catch {
      return false;
    }
  }

  private async degrade(
    onErr: OnStoreError,
    args: {
      config: StrategyConfig;
      key: string;
      cost: number;
      now: number;
      limit: number;
    },
  ): Promise<{ result: ConsumeResult; degraded: boolean }> {
    const { config, key, cost, now, limit } = args;

    if (onErr === "local-fallback" && this.fallbackStore) {
      try {
        const result = await this.fallbackStore.consume({
          key,
          config,
          cost,
          now,
        });
        return { result, degraded: true };
      } catch {
        // fall through to fail-open
      }
    }

    if (onErr === "fail-closed") {
      return {
        result: { allowed: false, limit, remaining: 0, resetMs: 0, retryAfterMs: 0 },
        degraded: true,
      };
    }

    // fail-open (default) — also the safety net when fallback is unavailable.
    return {
      result: { allowed: true, limit, remaining: limit, resetMs: 0 },
      degraded: true,
    };
  }
}

/** Convenience factory. */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  return new RateLimiter(options);
}
