import { describe, it, expect } from "vitest";
import { MemoryStore } from "@limiq/store-memory";
import {
  createRateLimiter,
  RateLimitConfigError,
  byUserId,
  buildHeaders,
  type Clock,
  type ConsumeArgs,
  type ConsumeResult,
  type RateLimitContext,
  type Store,
} from "../src/index.js";

const ctx = (over: Partial<RateLimitContext> = {}): RateLimitContext => ({
  ip: "1.2.3.4",
  method: "GET",
  path: "/x",
  headers: {},
  ...over,
});

class FailStore implements Store {
  calls = 0;
  async consume(_args: ConsumeArgs): Promise<ConsumeResult> {
    this.calls++;
    throw new Error("store down");
  }
  async healthcheck(): Promise<boolean> {
    return false;
  }
}

class MutableClock implements Clock {
  constructor(public t = 0) {}
  now(): number {
    return this.t;
  }
}

describe("config validation", () => {
  it("rejects a missing store", () => {
    expect(() =>
      // @ts-expect-error intentionally invalid
      createRateLimiter({ defaults: { strategy: "fixed-window", limit: 1, windowMs: 1 } }),
    ).toThrow(RateLimitConfigError);
  });

  it("rejects an invalid strategy config", () => {
    expect(() =>
      createRateLimiter({
        store: new MemoryStore({ sweepIntervalMs: 0 }),
        defaults: { strategy: "fixed-window", limit: -1, windowMs: 1000 },
      }),
    ).toThrow(RateLimitConfigError);
  });

  it("requires a fallbackStore for local-fallback", () => {
    expect(() =>
      createRateLimiter({
        store: new MemoryStore({ sweepIntervalMs: 0 }),
        onStoreError: "local-fallback",
        defaults: { strategy: "fixed-window", limit: 1, windowMs: 1000 },
      }),
    ).toThrow(RateLimitConfigError);
  });
});

describe("basic limiting", () => {
  it("allows then blocks per the default strategy", async () => {
    const limiter = createRateLimiter({
      store: new MemoryStore({ sweepIntervalMs: 0 }),
      defaults: { strategy: "fixed-window", limit: 2, windowMs: 10_000 },
    });
    expect((await limiter.check(ctx())).allowed).toBe(true);
    expect((await limiter.check(ctx())).allowed).toBe(true);
    expect((await limiter.check(ctx())).allowed).toBe(false);
  });

  it("partitions by resolver (different users are independent)", async () => {
    const limiter = createRateLimiter({
      store: new MemoryStore({ sweepIntervalMs: 0 }),
      keyResolver: byUserId,
      defaults: { strategy: "fixed-window", limit: 1, windowMs: 10_000 },
    });
    expect((await limiter.check(ctx({ userId: "a" }))).allowed).toBe(true);
    expect((await limiter.check(ctx({ userId: "b" }))).allowed).toBe(true);
    expect((await limiter.check(ctx({ userId: "a" }))).allowed).toBe(false);
  });

  it("produces timing fields", async () => {
    const limiter = createRateLimiter({
      store: new MemoryStore({ sweepIntervalMs: 0 }),
      defaults: { strategy: "fixed-window", limit: 1, windowMs: 10_000 },
    });
    const d = await limiter.check(ctx());
    expect(d.decidedAt).toBeGreaterThanOrEqual(d.receivedAt);
    expect(d.evaluationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("rule matching (first-match-wins)", () => {
  it("applies the first matching rule, else defaults", async () => {
    const limiter = createRateLimiter({
      store: new MemoryStore({ sweepIntervalMs: 0 }),
      defaults: { strategy: "fixed-window", limit: 100, windowMs: 10_000 },
      rules: [
        {
          match: { method: "POST", path: "/auth/*" },
          strategy: "fixed-window",
          limit: 1,
          windowMs: 10_000,
        },
      ],
    });
    const login = ctx({ method: "POST", path: "/auth/login" });
    expect((await limiter.check(login)).allowed).toBe(true);
    expect((await limiter.check(login)).allowed).toBe(false); // rule limit=1
    // A non-matching route uses defaults (limit 100).
    expect((await limiter.check(ctx({ path: "/other" }))).allowed).toBe(true);
  });
});

describe("degradation", () => {
  it("fail-open: allows and marks degraded on store error", async () => {
    const limiter = createRateLimiter({
      store: new FailStore(),
      onStoreError: "fail-open",
      circuitBreaker: false,
      defaults: { strategy: "fixed-window", limit: 1, windowMs: 10_000 },
    });
    const d = await limiter.check(ctx());
    expect(d.allowed).toBe(true);
    expect(d.degraded).toBe(true);
    expect(limiter.getMetrics()?.snapshot().counters.storeErrors).toBe(1);
  });

  it("fail-closed: blocks and marks degraded on store error", async () => {
    const limiter = createRateLimiter({
      store: new FailStore(),
      onStoreError: "fail-closed",
      circuitBreaker: false,
      defaults: { strategy: "fixed-window", limit: 1, windowMs: 10_000 },
    });
    const d = await limiter.check(ctx());
    expect(d.allowed).toBe(false);
    expect(d.degraded).toBe(true);
  });

  it("local-fallback: uses the fallback store", async () => {
    const limiter = createRateLimiter({
      store: new FailStore(),
      fallbackStore: new MemoryStore({ sweepIntervalMs: 0 }),
      onStoreError: "local-fallback",
      circuitBreaker: false,
      defaults: { strategy: "fixed-window", limit: 1, windowMs: 10_000 },
    });
    expect((await limiter.check(ctx())).allowed).toBe(true);
    const second = await limiter.check(ctx());
    expect(second.allowed).toBe(false); // fallback enforced the limit
    expect(second.degraded).toBe(true);
  });
});

describe("circuit breaker", () => {
  it("stops hitting the primary store after the threshold, within cooldown", async () => {
    const store = new FailStore();
    const clock = new MutableClock(0);
    const limiter = createRateLimiter({
      store,
      onStoreError: "fail-open",
      circuitBreaker: { threshold: 3, cooldownMs: 5000 },
      clock,
      defaults: { strategy: "fixed-window", limit: 1, windowMs: 10_000 },
    });
    for (let i = 0; i < 10; i++) await limiter.check(ctx());
    // After 3 failures the breaker opens; further calls skip the store.
    expect(store.calls).toBe(3);
  });

  it("probes again after the cooldown elapses", async () => {
    const store = new FailStore();
    const clock = new MutableClock(0);
    const limiter = createRateLimiter({
      store,
      onStoreError: "fail-open",
      circuitBreaker: { threshold: 2, cooldownMs: 5000 },
      clock,
      defaults: { strategy: "fixed-window", limit: 1, windowMs: 10_000 },
    });
    await limiter.check(ctx());
    await limiter.check(ctx()); // opens here
    expect(store.calls).toBe(2);
    await limiter.check(ctx()); // open, skipped
    expect(store.calls).toBe(2);
    clock.t = 6000; // cooldown passed
    await limiter.check(ctx()); // half-open probe hits store
    expect(store.calls).toBe(3);
  });
});

describe("metrics", () => {
  it("counts allowed/blocked and tracks top throttled keys", async () => {
    const limiter = createRateLimiter({
      store: new MemoryStore({ sweepIntervalMs: 0 }),
      keyResolver: byUserId,
      defaults: { strategy: "fixed-window", limit: 1, windowMs: 10_000 },
    });
    await limiter.check(ctx({ userId: "a" })); // allowed
    await limiter.check(ctx({ userId: "a" })); // blocked
    await limiter.check(ctx({ userId: "a" })); // blocked
    const snap = limiter.getMetrics()!.snapshot();
    expect(snap.counters.allowed).toBe(1);
    expect(snap.counters.blocked).toBe(2);
    expect(snap.topThrottled[0]?.blocked).toBe(2);
  });
});

describe("headers", () => {
  it("builds draft-7 headers and Retry-After on block", async () => {
    const limiter = createRateLimiter({
      store: new MemoryStore({ sweepIntervalMs: 0 }),
      defaults: { strategy: "fixed-window", limit: 1, windowMs: 2000 },
    });
    await limiter.check(ctx());
    const blocked = await limiter.check(ctx());
    const headers = buildHeaders(blocked, { standard: true });
    expect(headers["RateLimit-Limit"]).toBe("1");
    expect(headers["RateLimit-Remaining"]).toBe("0");
    expect(headers["Retry-After"]).toBeDefined();
  });

  it("emits legacy aliases when enabled", () => {
    const headers = buildHeaders(
      {
        allowed: true,
        limit: 10,
        remaining: 9,
        resetMs: 1000,
        strategy: "fixed-window",
        key: "k",
        degraded: false,
        receivedAt: 0,
        decidedAt: 0,
        evaluationMs: 0,
      },
      { standard: false, legacy: true },
    );
    expect(headers["X-RateLimit-Limit"]).toBe("10");
    expect(headers["RateLimit-Limit"]).toBeUndefined();
  });
});
