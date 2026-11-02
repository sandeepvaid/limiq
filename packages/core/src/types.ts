/**
 * Core type contracts for the rate limiter.
 *
 * Phase 0 (skeleton): these are the shapes the entire design hinges on.
 * No algorithm/engine bodies live here — only the contracts that `core`,
 * `stores`, `strategies`, `middleware`, and `metrics` all agree on.
 */

/** Concrete, closed set of supported HTTP methods (LOCKED §4). */
export type HttpMethod =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS";

/** Names of the supported algorithms, selected declaratively by config. */
export type StrategyName =
  | "fixed-window"
  | "sliding-window-counter"
  | "sliding-window-log"
  | "token-bucket"
  | "leaky-bucket";

/** Degradation behaviour when the store errors/times out (LOCKED §7). */
export type OnStoreError = "fail-open" | "fail-closed" | "local-fallback";

/**
 * Framework-neutral request context. Adapters translate their native request
 * into this; the core never sees `express`/`fastify` types.
 */
export interface RateLimitContext {
  ip: string;
  method: HttpMethod;
  /** Matched route template if available (e.g. "/transactions/:id"), else path. */
  path: string;
  headers: Record<string, string | undefined>;
  // Adapter-populated extras used by key resolvers:
  userId?: string;
  apiKey?: string;
  tenant?: string;
  /** Escape hatch to the native request object; core must not depend on it. */
  raw?: unknown;
}

/** Resolves the partition key for a request (IP, user, api-key, composite…). */
export type KeyResolver = (ctx: RateLimitContext) => string | Promise<string>;

/** The decision returned for a single evaluated request. */
export interface Decision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** ms until the window/bucket resets. */
  resetMs: number;
  /** Set when blocked: ms the client should wait before retrying. */
  retryAfterMs?: number;
  strategy: StrategyName;
  /** Fully namespaced store key the decision was made against. */
  key: string;
  /** True if served via the fail-open / local-fallback degradation path. */
  degraded: boolean;
  // Timing / audit (LOCKED):
  /** epoch ms when the request entered engine.check(). */
  receivedAt: number;
  /** epoch ms when the decision was produced. */
  decidedAt: number;
  /** decidedAt - receivedAt; feeds the latency histogram. */
  evaluationMs: number;
}

/**
 * Per-strategy tuning. A superset; each strategy reads the fields it needs and
 * config validation enforces the required ones per `strategy`.
 */
export interface StrategyConfig {
  strategy: StrategyName;
  // fixed-window / sliding-window-*:
  limit?: number;
  windowMs?: number;
  // token-bucket:
  capacity?: number;
  refillTokens?: number;
  refillIntervalMs?: number;
  // leaky-bucket:
  leakRatePerSec?: number;
}

/** Predicate/shape a rule matches against (first-match-wins in v1, LOCKED §16). */
export interface RuleMatch {
  method?: HttpMethod;
  /** Glob-style path match, e.g. "/auth/*". */
  path?: string;
  /** Optional custom predicate; ANDed with method/path when present. */
  predicate?: (ctx: RateLimitContext) => boolean;
}

/** A declarative rule = match + strategy config + optional overrides. */
export interface Rule extends StrategyConfig {
  match: RuleMatch;
  keyResolver?: KeyResolver;
  onStoreError?: OnStoreError;
}

/** Arguments passed to a store's atomic consume on the hot path. */
export interface ConsumeArgs {
  key: string;
  config: StrategyConfig;
  /** Weighted cost of this request (default 1). */
  cost: number;
  /** epoch ms; passed in for deterministic testing (redis path uses server time). */
  now: number;
}

/** Result of an atomic consume — the numbers needed to build a Decision. */
export interface ConsumeResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
  retryAfterMs?: number;
}

/**
 * The single contract every store implements. The hot path uses only
 * `consume` (one atomic op / one round-trip). `peek`/`reset` are admin/dashboard
 * read paths and are optional.
 */
export interface Store {
  consume(args: ConsumeArgs): Promise<ConsumeResult>;
  peek?(key: string): Promise<ConsumeResult | null>;
  reset?(key: string): Promise<void>;
  healthcheck(): Promise<boolean>;
}

/** Injectable time source; swap for a fake clock in tests. */
export interface Clock {
  now(): number;
}

/** Circuit-breaker tuning for the store degradation path (§7). */
export interface CircuitBreakerOptions {
  /** Consecutive store failures before the breaker opens. */
  threshold: number;
  /** How long the breaker stays open before a half-open probe (ms). */
  cooldownMs: number;
}

/** Resolves the weighted cost of a request (default 1). */
export type CostResolver = (ctx: RateLimitContext) => number;

/** Header emission options (draft-7 standard + optional legacy aliases). */
export interface HeaderOptions {
  standard?: boolean;
  legacy?: boolean;
}

/** Top-level options for creating a rate limiter. */
export interface RateLimiterOptions {
  /** Primary store (injected). */
  store: Store;
  /** Key namespace prefix; keys become `rl:{prefix}:{strategy}:{partition}`. */
  keyPrefix?: string;
  /** Fallback strategy config used when no rule matches. */
  defaults: StrategyConfig;
  /** Declarative per-route rules (first-match-wins in v1). */
  rules?: Rule[];
  /** Global default partition-key resolver (default: by IP). */
  keyResolver?: KeyResolver;
  /** Global default degradation policy (default: 'fail-open'). */
  onStoreError?: OnStoreError;
  /** Store used when onStoreError is 'local-fallback'. */
  fallbackStore?: Store;
  /** Header emission (default: standard on, legacy off). */
  headers?: HeaderOptions;
  /** Metrics collector; pass false to disable. */
  metrics?: MetricsCollector | false;
  /** Injectable clock (default: system clock). */
  clock?: Clock;
  /** Weighted cost resolver (default: () => 1). */
  cost?: CostResolver;
  /** Circuit breaker; pass false to disable (enabled by default). */
  circuitBreaker?: CircuitBreakerOptions | false;
}

/** One recorded evaluation for the metrics collector. */
export interface MetricsEvent {
  decision: Decision;
  route: string;
  tenant?: string;
}

/** A point-in-time aggregate snapshot (what the dashboard/exporters pull). */
export interface MetricsSnapshot {
  windowMs: number;
  since: number;
  counters: {
    allowed: number;
    blocked: number;
    degraded: number;
    storeErrors: number;
  };
  byRoute: Record<string, { allowed: number; blocked: number }>;
  latency: { p50: number; p95: number; p99: number; count: number };
  topThrottled: Array<{ key: string; blocked: number }>;
}

/**
 * Metrics collector contract. `record`/`recordStoreError` run on the hot path
 * and MUST be O(1), synchronous, non-throwing (no I/O).
 */
export interface MetricsCollector {
  record(event: MetricsEvent): void;
  recordStoreError(): void;
  snapshot(): MetricsSnapshot;
  reset(): void;
}
