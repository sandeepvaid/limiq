import type { KeyResolver, RateLimitContext } from "./types.js";

/** Partition by client IP. */
export const byIp: KeyResolver = (ctx) => `ip:${ctx.ip}`;

/** Partition by authenticated user id, falling back to IP. */
export const byUserId: KeyResolver = (ctx) =>
  ctx.userId ? `user:${ctx.userId}` : `ip:${ctx.ip}`;

/** Partition by API key, falling back to IP. */
export const byApiKey: KeyResolver = (ctx) =>
  ctx.apiKey ? `apikey:${ctx.apiKey}` : `ip:${ctx.ip}`;

/** Partition by route (method + path). */
export const byRoute: KeyResolver = (ctx) => `route:${ctx.method}:${ctx.path}`;

/**
 * Combine several resolvers into one composite partition key.
 * Example: composite(byRoute, byUserId) => "route:GET:/x|user:42".
 */
export function composite(...resolvers: KeyResolver[]): KeyResolver {
  if (resolvers.length === 0) {
    throw new Error("composite() requires at least one resolver");
  }
  return async (ctx: RateLimitContext) => {
    const parts = await Promise.all(resolvers.map((r) => r(ctx)));
    return parts.join("|");
  };
}
