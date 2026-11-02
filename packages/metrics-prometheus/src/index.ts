/**
 * @limiq/prometheus — render a MetricsSnapshot as Prometheus exposition
 * text. No prom-client dependency; the format is hand-rolled (v0.0.4).
 */
import type { MetricsCollector, MetricsSnapshot } from "@limiq/core";

export const PROM_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

/** Render a snapshot to Prometheus exposition text. */
export function toPrometheus(snapshot: MetricsSnapshot): string {
  const lines: string[] = [];
  const { counters, byRoute, latency, topThrottled } = snapshot;

  lines.push("# HELP ratelimit_requests_total Total rate-limit decisions.");
  lines.push("# TYPE ratelimit_requests_total counter");
  lines.push(`ratelimit_requests_total{result="allowed"} ${counters.allowed}`);
  lines.push(`ratelimit_requests_total{result="blocked"} ${counters.blocked}`);

  lines.push("# HELP ratelimit_degraded_total Decisions served via degradation.");
  lines.push("# TYPE ratelimit_degraded_total counter");
  lines.push(`ratelimit_degraded_total ${counters.degraded}`);

  lines.push("# HELP ratelimit_store_errors_total Store errors encountered.");
  lines.push("# TYPE ratelimit_store_errors_total counter");
  lines.push(`ratelimit_store_errors_total ${counters.storeErrors}`);

  lines.push("# HELP ratelimit_requests_by_route_total Decisions per route.");
  lines.push("# TYPE ratelimit_requests_by_route_total counter");
  for (const [route, v] of Object.entries(byRoute)) {
    const r = escapeLabel(route);
    lines.push(`ratelimit_requests_by_route_total{route="${r}",result="allowed"} ${v.allowed}`);
    lines.push(`ratelimit_requests_by_route_total{route="${r}",result="blocked"} ${v.blocked}`);
  }

  lines.push("# HELP ratelimit_overhead_ms Limiter evaluation overhead (ms).");
  lines.push("# TYPE ratelimit_overhead_ms gauge");
  lines.push(`ratelimit_overhead_ms{quantile="0.5"} ${latency.p50}`);
  lines.push(`ratelimit_overhead_ms{quantile="0.95"} ${latency.p95}`);
  lines.push(`ratelimit_overhead_ms{quantile="0.99"} ${latency.p99}`);

  lines.push("# HELP ratelimit_top_throttled Blocked count for top throttled keys.");
  lines.push("# TYPE ratelimit_top_throttled gauge");
  for (const entry of topThrottled) {
    lines.push(`ratelimit_top_throttled{key="${escapeLabel(entry.key)}"} ${entry.blocked}`);
  }

  return lines.join("\n") + "\n";
}

/** Minimal response shape for the convenience handler. */
export interface PromResponseLike {
  setHeader(name: string, value: string): void;
  status(code: number): PromResponseLike;
  send(body: string): void;
}

/**
 * Convenience Express-style handler for `GET /metrics`. Pass the limiter's
 * collector (`limiter.getMetrics()`).
 */
export function prometheusHandler(collector: MetricsCollector) {
  return function handle(_req: unknown, res: PromResponseLike): void {
    res.setHeader("Content-Type", PROM_CONTENT_TYPE);
    res.status(200).send(toPrometheus(collector.snapshot()));
  };
}
