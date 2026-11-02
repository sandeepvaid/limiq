import type { StrategyName } from "./types.js";

/**
 * Build the fully namespaced base key for a decision.
 *
 * Shape: `rl:{prefix}:{strategy}:{<partition>}`
 *
 * The partition is wrapped in `{...}` so it acts as a Redis Cluster **hash tag**:
 * every sub-key a multi-key strategy derives (by appending suffixes after the
 * closing brace) hashes to the same slot, keeping the whole decision atomic.
 */
export function buildKey(
  prefix: string,
  strategy: StrategyName,
  partition: string,
): string {
  return `rl:${prefix}:${strategy}:{${partition}}`;
}
