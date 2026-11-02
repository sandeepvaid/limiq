import type { Decision, HeaderOptions } from "./types.js";

/**
 * Build RateLimit headers from a decision, following the IETF draft-7
 * `RateLimit-*` conventions (reset expressed in seconds). Optionally also emit
 * legacy `X-RateLimit-*` aliases.
 */
export function buildHeaders(
  decision: Decision,
  options: HeaderOptions = {},
): Record<string, string> {
  const { standard = true, legacy = false } = options;
  const headers: Record<string, string> = {};

  const limit = String(decision.limit);
  const remaining = String(Math.max(0, decision.remaining));
  const reset = String(Math.ceil(decision.resetMs / 1000));

  if (standard) {
    headers["RateLimit-Limit"] = limit;
    headers["RateLimit-Remaining"] = remaining;
    headers["RateLimit-Reset"] = reset;
  }
  if (legacy) {
    headers["X-RateLimit-Limit"] = limit;
    headers["X-RateLimit-Remaining"] = remaining;
    headers["X-RateLimit-Reset"] = reset;
  }
  if (!decision.allowed && decision.retryAfterMs !== undefined) {
    headers["Retry-After"] = String(Math.ceil(decision.retryAfterMs / 1000));
  }
  return headers;
}
