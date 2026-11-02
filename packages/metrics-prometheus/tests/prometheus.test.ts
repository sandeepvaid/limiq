import { describe, it, expect } from "vitest";
import { DefaultMetricsCollector, type Decision } from "@limiq/core";
import { toPrometheus } from "../src/index.js";

const decision = (over: Partial<Decision>): Decision => ({
  allowed: true,
  limit: 10,
  remaining: 9,
  resetMs: 1000,
  strategy: "fixed-window",
  key: "ip:1.2.3.4",
  degraded: false,
  receivedAt: 0,
  decidedAt: 1,
  evaluationMs: 1,
  ...over,
});

describe("toPrometheus", () => {
  it("renders counters and per-route series", () => {
    const c = new DefaultMetricsCollector();
    c.record({ decision: decision({ allowed: true }), route: "GET /x" });
    c.record({ decision: decision({ allowed: false, key: "ip:9" }), route: "GET /x" });
    const text = toPrometheus(c.snapshot());

    expect(text).toContain("# TYPE ratelimit_requests_total counter");
    expect(text).toContain('ratelimit_requests_total{result="allowed"} 1');
    expect(text).toContain('ratelimit_requests_total{result="blocked"} 1');
    expect(text).toContain('ratelimit_requests_by_route_total{route="GET /x",result="blocked"} 1');
    expect(text).toContain('ratelimit_top_throttled{key="ip:9"} 1');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("escapes label values", () => {
    const c = new DefaultMetricsCollector();
    c.record({ decision: decision({ allowed: false, key: 'weird"key\\x' }), route: "GET /a" });
    const text = toPrometheus(c.snapshot());
    expect(text).toContain('key="weird\\"key\\\\x"');
  });
});
