import type { ConsumeResult, StrategyConfig } from "@limiq/core";

/**
 * Pure, deterministic algorithm implementations used by the memory store.
 * Each takes the previous state (or undefined), the config, the request cost,
 * and `now` (ms), and returns the next state, the decision numbers, and the TTL.
 *
 * The redis store mirrors this exact math in Lua. All math clamps against clock
 * skew (elapsed is never negative; levels/tokens never go out of range).
 */

export interface Evaluation<S> {
  state: S;
  result: ConsumeResult;
  /** Suggested TTL for this key in ms (store self-cleans after this). */
  ttlMs: number;
}

export interface FixedWindowState {
  windowId: number;
  count: number;
}
export interface SlidingCounterState {
  curId: number;
  curCount: number;
  prevCount: number;
}
export interface SlidingLogState {
  timestamps: number[];
}
export interface TokenBucketState {
  tokens: number;
  lastRefill: number;
}
export interface LeakyBucketState {
  level: number;
  lastLeak: number;
}

export function fixedWindow(
  prev: FixedWindowState | undefined,
  config: StrategyConfig,
  cost: number,
  now: number,
): Evaluation<FixedWindowState> {
  const limit = config.limit as number;
  const windowMs = config.windowMs as number;
  const windowId = Math.floor(now / windowMs);
  const resetAt = (windowId + 1) * windowMs;
  let count = prev && prev.windowId === windowId ? prev.count : 0;
  const allowed = count + cost <= limit;
  if (allowed) count += cost;
  const resetMs = resetAt - now;
  return {
    state: { windowId, count },
    result: {
      allowed,
      limit,
      remaining: Math.max(0, limit - count),
      resetMs,
      ...(allowed ? {} : { retryAfterMs: resetMs }),
    },
    ttlMs: resetMs,
  };
}

export function slidingWindowCounter(
  prev: SlidingCounterState | undefined,
  config: StrategyConfig,
  cost: number,
  now: number,
): Evaluation<SlidingCounterState> {
  const limit = config.limit as number;
  const windowMs = config.windowMs as number;
  const curId = Math.floor(now / windowMs);

  let curCount = 0;
  let prevCount = 0;
  if (prev) {
    if (prev.curId === curId) {
      curCount = prev.curCount;
      prevCount = prev.prevCount;
    } else if (prev.curId === curId - 1) {
      prevCount = prev.curCount;
    }
    // gap > 1 window: both remain 0
  }

  const elapsedInCur = now - curId * windowMs;
  const prevWeight = (windowMs - elapsedInCur) / windowMs;
  const estimate = prevCount * prevWeight + curCount;
  const allowed = estimate + cost <= limit;
  if (allowed) curCount += cost;
  const estimateAfter = prevCount * prevWeight + curCount;
  const resetMs = (curId + 1) * windowMs - now;

  return {
    state: { curId, curCount, prevCount },
    result: {
      allowed,
      limit,
      remaining: Math.max(0, Math.floor(limit - estimateAfter)),
      resetMs,
      ...(allowed ? {} : { retryAfterMs: resetMs }),
    },
    ttlMs: 2 * windowMs,
  };
}

export function slidingWindowLog(
  prev: SlidingLogState | undefined,
  config: StrategyConfig,
  cost: number,
  now: number,
): Evaluation<SlidingLogState> {
  const limit = config.limit as number;
  const windowMs = config.windowMs as number;
  const cutoff = now - windowMs;

  const timestamps = prev ? prev.timestamps.filter((t) => t > cutoff) : [];
  const count = timestamps.length;
  const allowed = count + cost <= limit;

  if (allowed) {
    const last = timestamps.length ? (timestamps[timestamps.length - 1] as number) : now;
    const stamp = Math.max(now, last); // keep sorted under clock skew
    for (let i = 0; i < cost; i++) timestamps.push(stamp);
  }

  const oldest = timestamps.length ? (timestamps[0] as number) : now;
  const resetMs = timestamps.length ? Math.max(0, oldest + windowMs - now) : 0;

  return {
    state: { timestamps },
    result: {
      allowed,
      limit,
      remaining: Math.max(0, limit - timestamps.length),
      resetMs,
      ...(allowed ? {} : { retryAfterMs: Math.max(0, oldest + windowMs - now) }),
    },
    ttlMs: windowMs,
  };
}

export function tokenBucket(
  prev: TokenBucketState | undefined,
  config: StrategyConfig,
  cost: number,
  now: number,
): Evaluation<TokenBucketState> {
  const capacity = config.capacity as number;
  const rate = (config.refillTokens as number) / (config.refillIntervalMs as number); // tokens/ms

  let tokens = prev ? prev.tokens : capacity;
  const last = prev ? prev.lastRefill : now;
  const elapsed = Math.max(0, now - last);
  tokens = Math.min(capacity, tokens + elapsed * rate);

  const allowed = tokens >= cost;
  if (allowed) tokens -= cost;

  const timeToFull = (capacity - tokens) / rate;
  const resetMs = Math.ceil(timeToFull);
  const retryAfterMs = allowed ? undefined : Math.ceil((cost - tokens) / rate);

  return {
    state: { tokens, lastRefill: now },
    result: {
      allowed,
      limit: capacity,
      remaining: Math.floor(tokens),
      resetMs,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    },
    ttlMs: Math.max(config.refillIntervalMs as number, Math.ceil(timeToFull)),
  };
}

export function leakyBucket(
  prev: LeakyBucketState | undefined,
  config: StrategyConfig,
  cost: number,
  now: number,
): Evaluation<LeakyBucketState> {
  const capacity = config.capacity as number;
  const leakPerMs = (config.leakRatePerSec as number) / 1000;

  let level = prev ? prev.level : 0;
  const last = prev ? prev.lastLeak : now;
  const elapsed = Math.max(0, now - last);
  level = Math.max(0, level - elapsed * leakPerMs);

  const allowed = level + cost <= capacity;
  if (allowed) level += cost;

  const resetMs = Math.ceil(level / leakPerMs); // time to drain fully
  const retryAfterMs = allowed
    ? undefined
    : Math.ceil((level + cost - capacity) / leakPerMs);

  return {
    state: { level, lastLeak: now },
    result: {
      allowed,
      limit: capacity,
      remaining: Math.floor(capacity - level),
      resetMs,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    },
    ttlMs: Math.max(1, Math.ceil(capacity / leakPerMs)),
  };
}
