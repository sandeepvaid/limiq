import { RateLimitConfigError } from "./errors.js";
import type { StrategyConfig, StrategyName } from "./types.js";

const STRATEGY_NAMES: readonly StrategyName[] = [
  "fixed-window",
  "sliding-window-counter",
  "sliding-window-log",
  "token-bucket",
  "leaky-bucket",
];

function requirePositive(
  value: number | undefined,
  field: string,
  strategy: StrategyName,
): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RateLimitConfigError(
      `Strategy "${strategy}" requires "${field}" to be a positive number (got ${String(value)}).`,
    );
  }
}

/** Validate a single strategy config; throws RateLimitConfigError if invalid. */
export function validateStrategyConfig(config: StrategyConfig): void {
  if (!config || typeof config !== "object") {
    throw new RateLimitConfigError("Strategy config must be an object.");
  }
  if (!STRATEGY_NAMES.includes(config.strategy)) {
    throw new RateLimitConfigError(
      `Unknown strategy "${String(config.strategy)}". Valid: ${STRATEGY_NAMES.join(", ")}.`,
    );
  }
  switch (config.strategy) {
    case "fixed-window":
    case "sliding-window-counter":
    case "sliding-window-log":
      requirePositive(config.limit, "limit", config.strategy);
      requirePositive(config.windowMs, "windowMs", config.strategy);
      break;
    case "token-bucket":
      requirePositive(config.capacity, "capacity", config.strategy);
      requirePositive(config.refillTokens, "refillTokens", config.strategy);
      requirePositive(
        config.refillIntervalMs,
        "refillIntervalMs",
        config.strategy,
      );
      break;
    case "leaky-bucket":
      requirePositive(config.capacity, "capacity", config.strategy);
      requirePositive(config.leakRatePerSec, "leakRatePerSec", config.strategy);
      break;
  }
}

/** The nominal "limit" shown in headers for a strategy config. */
export function nominalLimit(config: StrategyConfig): number {
  switch (config.strategy) {
    case "token-bucket":
    case "leaky-bucket":
      return config.capacity ?? 0;
    default:
      return config.limit ?? 0;
  }
}

export { STRATEGY_NAMES };
