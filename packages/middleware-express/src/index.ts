/**
 * @limiq/express — thin Express adapter over @limiq/core.
 *
 * Uses minimal structural types so the package has no `express` dependency.
 */
import type {
  Decision,
  HttpMethod,
  RateLimitContext,
  RateLimiter,
} from "@limiq/core";

/** Minimal shape of the bits of an Express request we read. */
export interface ExpressRequestLike {
  ip?: string;
  method: string;
  path: string;
  originalUrl?: string;
  route?: { path?: string };
  socket?: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
  [key: string]: unknown;
}

/** Minimal shape of the bits of an Express response we use. */
export interface ExpressResponseLike {
  setHeader(name: string, value: string): void;
  status(code: number): ExpressResponseLike;
  json(body: unknown): void;
  headersSent?: boolean;
}

export type NextFn = (err?: unknown) => void;

export interface ExpressRateLimitOptions {
  /** Add userId/apiKey/tenant (and anything else) onto the context. */
  contextExtras?: (req: ExpressRequestLike) => Partial<RateLimitContext>;
  /** Emit RateLimit headers (default: true). */
  setHeaders?: boolean;
  /** HTTP status for blocked requests (default: 429). */
  statusCode?: number;
  /** Custom handler for blocked requests; replaces the default 429 JSON body. */
  onBlocked?: (
    req: ExpressRequestLike,
    res: ExpressResponseLike,
    decision: Decision,
  ) => void;
}

function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function toContext(
  req: ExpressRequestLike,
  extras: ExpressRateLimitOptions["contextExtras"],
): RateLimitContext {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = headerValue(v);
  }
  const base: RateLimitContext = {
    ip: req.ip ?? req.socket?.remoteAddress ?? "unknown",
    method: req.method.toUpperCase() as HttpMethod,
    // Prefer the matched route template to keep metrics cardinality low.
    path: req.route?.path ?? req.path,
    headers,
  };
  return extras ? { ...base, ...extras(req) } : base;
}

/**
 * Build Express middleware from a configured RateLimiter. The core already
 * fails open internally, so this middleware never blocks a request due to an
 * internal error.
 */
export function expressRateLimit(
  limiter: RateLimiter,
  options: ExpressRateLimitOptions = {},
) {
  const { contextExtras, setHeaders = true, statusCode = 429, onBlocked } = options;

  return function rateLimitMiddleware(
    req: ExpressRequestLike,
    res: ExpressResponseLike,
    next: NextFn,
  ): void {
    const ctx = toContext(req, contextExtras);
    limiter
      .check(ctx)
      .then((decision) => {
        if (setHeaders && !res.headersSent) {
          for (const [name, value] of Object.entries(limiter.headersFor(decision))) {
            res.setHeader(name, value);
          }
        }
        if (decision.allowed) {
          next();
          return;
        }
        if (onBlocked) {
          onBlocked(req, res, decision);
          return;
        }
        res.status(statusCode).json({
          error: "Too Many Requests",
          retryAfter:
            decision.retryAfterMs !== undefined
              ? Math.ceil(decision.retryAfterMs / 1000)
              : undefined,
        });
      })
      .catch(() => {
        // Last-resort safety net: the core already fails open, but if anything
        // unexpected throws, proceed rather than break the route.
        next();
      });
  };
}
