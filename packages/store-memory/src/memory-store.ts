import type { ConsumeArgs, ConsumeResult, Store, StrategyConfig } from "@limiq/core";
import {
  fixedWindow,
  leakyBucket,
  slidingWindowCounter,
  slidingWindowLog,
  tokenBucket,
  type Evaluation,
} from "./algorithms.js";

interface Entry {
  state: unknown;
  expiresAt: number;
}

export interface MemoryStoreOptions {
  /** Max distinct keys kept; least-recently-used are evicted beyond this. Default 100_000. */
  maxEntries?: number;
  /** Background sweep interval for expired keys (ms). 0 disables. Default 30_000. */
  sweepIntervalMs?: number;
}

/**
 * Single-process in-memory store. Great for dev/test and as the fail-open
 * `local-fallback`. Not shared across instances — do not use as the primary
 * store behind multiple replicas.
 */
export class MemoryStore implements Store {
  private readonly map = new Map<string, Entry>();
  private readonly maxEntries: number;
  private readonly sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: MemoryStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 100_000;
    const sweepMs = options.sweepIntervalMs ?? 30_000;
    if (sweepMs > 0) {
      this.sweepTimer = setInterval(() => this.sweep(Date.now()), sweepMs);
      // Never keep the event loop alive just for the sweeper.
      this.sweepTimer.unref?.();
    }
  }

  async consume(args: ConsumeArgs): Promise<ConsumeResult> {
    const { key, config, cost, now } = args;
    const prev = this.getLive(key, now);
    const evaluation = this.evaluate(prev?.state, config, cost, now);
    this.setEntry(key, evaluation.state, now + evaluation.ttlMs);
    return evaluation.result;
  }

  /**
   * Non-mutating read that needs the strategy config (admin/dashboard use).
   * The generic `Store.peek(key)` can't evaluate without knowing the strategy,
   * so the memory store exposes this config-aware variant instead.
   */
  peekWith(key: string, config: StrategyConfig, now = Date.now()): ConsumeResult | null {
    const entry = this.getLive(key, now);
    if (!entry) return null;
    return this.evaluate(entry.state, config, 0, now).result;
  }

  async reset(key: string): Promise<void> {
    this.map.delete(key);
  }

  async healthcheck(): Promise<boolean> {
    return true;
  }

  /** Clears all state (tests/shutdown). */
  clear(): void {
    this.map.clear();
  }

  /** Stops the background sweeper. */
  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  size(): number {
    return this.map.size;
  }

  private evaluate(
    prev: unknown,
    config: StrategyConfig,
    cost: number,
    now: number,
  ): Evaluation<unknown> {
    switch (config.strategy) {
      case "fixed-window":
        return fixedWindow(prev as never, config, cost, now);
      case "sliding-window-counter":
        return slidingWindowCounter(prev as never, config, cost, now);
      case "sliding-window-log":
        return slidingWindowLog(prev as never, config, cost, now);
      case "token-bucket":
        return tokenBucket(prev as never, config, cost, now);
      case "leaky-bucket":
        return leakyBucket(prev as never, config, cost, now);
    }
  }

  private getLive(key: string, now: number): Entry | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.map.delete(key);
      return undefined;
    }
    // LRU touch: move to most-recent position.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  private setEntry(key: string, state: unknown, expiresAt: number): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { state, expiresAt });
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.map) {
      if (entry.expiresAt <= now) this.map.delete(key);
    }
  }
}
