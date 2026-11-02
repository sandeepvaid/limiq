/**
 * @limiq/core — framework-agnostic rate limiting engine.
 */

// Types & contracts
export type {
  HttpMethod,
  StrategyName,
  OnStoreError,
  RateLimitContext,
  KeyResolver,
  Decision,
  StrategyConfig,
  RuleMatch,
  Rule,
  ConsumeArgs,
  ConsumeResult,
  Store,
  Clock,
  CircuitBreakerOptions,
  CostResolver,
  HeaderOptions,
  RateLimiterOptions,
  MetricsEvent,
  MetricsSnapshot,
  MetricsCollector,
} from "./types.js";
export type { Strategy } from "./strategy.interface.js";

// Engine
export { RateLimiter, createRateLimiter } from "./engine.js";

// Errors
export { RateLimitConfigError, RateLimitStoreError } from "./errors.js";

// Clock
export { systemClock } from "./clock.js";

// Config helpers
export {
  validateStrategyConfig,
  nominalLimit,
  STRATEGY_NAMES,
} from "./config.js";

// Key resolvers
export { byIp, byUserId, byApiKey, byRoute, composite } from "./resolvers.js";

// Key namespacing
export { buildKey } from "./namespace.js";

// Rule matching
export { matchRule } from "./matcher.js";

// Headers
export { buildHeaders } from "./headers.js";

// Metrics
export { DefaultMetricsCollector } from "./metrics.js";
export type { MetricsOptions } from "./metrics.js";

// Circuit breaker
export { CircuitBreaker } from "./circuit-breaker.js";
export type { CircuitState } from "./circuit-breaker.js";
