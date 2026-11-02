import { describe, it, expect } from "vitest";
import { createRateLimiter } from "@limiq/core";
import { MemoryStore } from "@limiq/store-memory";
import { routeDashboard, type DashboardOptions } from "../src/index.js";

function setup(): { options: DashboardOptions } {
  const limiter = createRateLimiter({
    store: new MemoryStore({ sweepIntervalMs: 0 }),
    defaults: { strategy: "fixed-window", limit: 5, windowMs: 10_000 },
  });
  return { options: { collector: limiter.getMetrics()!, limiter } };
}

const req = (
  method: string,
  path: string,
  isAdmin = false,
  query = "",
) => ({
  method,
  path,
  query: new URLSearchParams(query),
  isAdmin,
});

describe("routeDashboard", () => {
  it("serves the HTML page at the base path", async () => {
    const { options } = setup();
    const r = await routeDashboard(options, req("GET", "/__ratelimit/"));
    expect(r.status).toBe(200);
    expect(r.contentType).toContain("text/html");
    expect(r.body).toContain("Rate Limiter Dashboard");
  });

  it("returns a metrics snapshot as JSON", async () => {
    const { options } = setup();
    const r = await routeDashboard(options, req("GET", "/__ratelimit/api/metrics"));
    expect(r.contentType).toContain("application/json");
    const data = JSON.parse(r.body);
    expect(data.counters).toBeDefined();
    expect(data.latency).toBeDefined();
  });

  it("reports health", async () => {
    const { options } = setup();
    const r = await routeDashboard(options, req("GET", "/__ratelimit/api/health"));
    expect(JSON.parse(r.body)).toMatchObject({ ok: true, store: true });
  });

  it("forbids reset without admin", async () => {
    const { options } = setup();
    const r = await routeDashboard(
      options,
      req("POST", "/__ratelimit/api/reset", false, "key=ip:1"),
    );
    expect(r.status).toBe(403);
  });

  it("allows reset with admin + key", async () => {
    const { options } = setup();
    const r = await routeDashboard(
      options,
      req("POST", "/__ratelimit/api/reset", true, "key=ip:1"),
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ ok: true, reset: "ip:1" });
  });

  it("400s on reset without a key", async () => {
    const { options } = setup();
    const r = await routeDashboard(options, req("POST", "/__ratelimit/api/reset", true));
    expect(r.status).toBe(400);
  });

  it("404s unknown sub-paths", async () => {
    const { options } = setup();
    const r = await routeDashboard(options, req("GET", "/__ratelimit/nope"));
    expect(r.status).toBe(404);
  });
});
