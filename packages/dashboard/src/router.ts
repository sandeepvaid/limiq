import type { MetricsCollector, RateLimiter } from "@limiq/core";
import { dashboardHtml } from "./html.js";

export interface DashboardOptions {
  /** Metrics source (usually `limiter.getMetrics()`). */
  collector: MetricsCollector;
  /** Limiter — enables `/api/health` and admin `/api/reset`. */
  limiter?: RateLimiter;
  /** Mount path (default: "/__ratelimit"). No trailing slash. */
  basePath?: string;
  /** UI poll interval in ms (default: 2000). */
  pollMs?: number;
  /** Guards admin endpoints (reset). Defaults to deny-all. */
  isAdmin?: (req: unknown) => boolean;
}

export interface DashboardRequest {
  method: string;
  /** Full request path (we strip basePath ourselves). */
  path: string;
  query: URLSearchParams;
  /** Result of options.isAdmin(nativeReq), computed by the adapter. */
  isAdmin: boolean;
}

export interface DashboardResponse {
  status: number;
  contentType: string;
  body: string;
}

const json = (status: number, data: unknown): DashboardResponse => ({
  status,
  contentType: "application/json; charset=utf-8",
  body: JSON.stringify(data),
});

/**
 * Framework-agnostic dashboard router. Returns the response to send; adapters
 * (e.g. Express) translate it to the native response.
 */
export async function routeDashboard(
  options: DashboardOptions,
  req: DashboardRequest,
): Promise<DashboardResponse> {
  const basePath = options.basePath ?? "/__ratelimit";
  const pollMs = options.pollMs ?? 2000;

  if (!req.path.startsWith(basePath)) {
    return json(404, { error: "Not found" });
  }
  const sub = req.path.slice(basePath.length) || "/";

  if (req.method === "GET" && (sub === "/" || sub === "/index.html")) {
    return {
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: dashboardHtml(basePath, pollMs),
    };
  }

  if (req.method === "GET" && sub === "/api/metrics") {
    return json(200, options.collector.snapshot());
  }

  if (req.method === "GET" && sub === "/api/health") {
    const store = options.limiter ? await options.limiter.health() : null;
    return json(200, { ok: true, store });
  }

  if (req.method === "POST" && sub === "/api/reset") {
    if (!req.isAdmin) return json(403, { error: "Forbidden" });
    if (!options.limiter) return json(400, { error: "No limiter configured" });
    const key = req.query.get("key");
    if (!key) return json(400, { error: "Missing `key` query param" });
    await options.limiter.resetByKey(key);
    return json(200, { ok: true, reset: key });
  }

  return json(404, { error: "Not found" });
}
