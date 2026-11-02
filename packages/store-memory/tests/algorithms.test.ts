import { describe, it, expect, beforeEach } from "vitest";
import type { StrategyConfig } from "@limiq/core";
import { MemoryStore } from "../src/index.js";

let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore({ sweepIntervalMs: 0 });
});

const consume = (key: string, config: StrategyConfig, now: number, cost = 1) =>
  store.consume({ key, config, cost, now });

describe("fixed-window", () => {
  const cfg: StrategyConfig = { strategy: "fixed-window", limit: 3, windowMs: 1000 };

  it("allows up to the limit then blocks, with correct remaining", async () => {
    const r1 = await consume("k", cfg, 0);
    const r2 = await consume("k", cfg, 10);
    const r3 = await consume("k", cfg, 20);
    const r4 = await consume("k", cfg, 30);
    expect([r1.allowed, r2.allowed, r3.allowed, r4.allowed]).toEqual([true, true, true, false]);
    expect([r1.remaining, r2.remaining, r3.remaining]).toEqual([2, 1, 0]);
    expect(r4.remaining).toBe(0);
  });

  it("sets Retry-After = resetMs on block", async () => {
    await consume("k", cfg, 0);
    await consume("k", cfg, 0);
    await consume("k", cfg, 0);
    const blocked = await consume("k", cfg, 400);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(600); // window ends at 1000
    expect(blocked.resetMs).toBe(600);
  });

  it("resets at the next window boundary", async () => {
    for (let i = 0; i < 3; i++) await consume("k", cfg, 100);
    expect((await consume("k", cfg, 100)).allowed).toBe(false);
    const next = await consume("k", cfg, 1000);
    expect(next.allowed).toBe(true);
    expect(next.remaining).toBe(2);
  });

  it("honours weighted cost", async () => {
    const a = await consume("k", cfg, 0, 2); // count 2
    const b = await consume("k", cfg, 0, 2); // 2+2 > 3 => blocked
    expect(a.allowed).toBe(true);
    expect(a.remaining).toBe(1);
    expect(b.allowed).toBe(false);
  });

  it("blocks when a single cost exceeds the limit", async () => {
    const r = await consume("k", cfg, 0, 5);
    expect(r.allowed).toBe(false);
  });
});

describe("token-bucket", () => {
  // capacity 3, refill 3 tokens / 3000ms => 1 token/sec
  const cfg: StrategyConfig = {
    strategy: "token-bucket",
    capacity: 3,
    refillTokens: 3,
    refillIntervalMs: 3000,
  };

  it("allows a burst up to capacity then blocks", async () => {
    const rs = [];
    for (let i = 0; i < 4; i++) rs.push(await consume("k", cfg, 0));
    expect(rs.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(rs[2]!.remaining).toBe(0);
  });

  it("refills over time (1 token after 1s)", async () => {
    for (let i = 0; i < 3; i++) await consume("k", cfg, 0);
    expect((await consume("k", cfg, 0)).allowed).toBe(false);
    const after = await consume("k", cfg, 1000);
    expect(after.allowed).toBe(true);
    expect((await consume("k", cfg, 1000)).allowed).toBe(false); // only 1 refilled
  });

  it("reports retryAfter when empty", async () => {
    for (let i = 0; i < 3; i++) await consume("k", cfg, 0);
    const blocked = await consume("k", cfg, 0);
    expect(blocked.retryAfterMs).toBe(1000); // 1s to refill 1 token
  });

  it("caps at capacity (no infinite accumulation)", async () => {
    await consume("k", cfg, 0);
    const r = await consume("k", cfg, 100_000); // long idle
    expect(r.remaining).toBeLessThanOrEqual(3);
  });
});

describe("leaky-bucket", () => {
  // capacity 3, leak 1/sec
  const cfg: StrategyConfig = { strategy: "leaky-bucket", capacity: 3, leakRatePerSec: 1 };

  it("allows up to capacity then blocks", async () => {
    const rs = [];
    for (let i = 0; i < 4; i++) rs.push(await consume("k", cfg, 0));
    expect(rs.map((r) => r.allowed)).toEqual([true, true, true, false]);
  });

  it("leaks over time", async () => {
    for (let i = 0; i < 3; i++) await consume("k", cfg, 0);
    expect((await consume("k", cfg, 0)).allowed).toBe(false);
    expect((await consume("k", cfg, 1000)).allowed).toBe(true); // 1 leaked
  });

  it("reports retryAfter when full", async () => {
    for (let i = 0; i < 3; i++) await consume("k", cfg, 0);
    const blocked = await consume("k", cfg, 0);
    expect(blocked.retryAfterMs).toBe(1000);
  });
});

describe("sliding-window-log", () => {
  const cfg: StrategyConfig = { strategy: "sliding-window-log", limit: 3, windowMs: 1000 };

  it("allows exactly limit within the window, blocks the next", async () => {
    const r = [];
    for (let i = 0; i < 4; i++) r.push(await consume("k", cfg, 0));
    expect(r.map((x) => x.allowed)).toEqual([true, true, true, false]);
    expect(r[3]!.retryAfterMs).toBe(1000); // oldest (0) frees at 1000
  });

  it("frees a slot once the oldest timestamp expires", async () => {
    for (let i = 0; i < 3; i++) await consume("k", cfg, 0);
    expect((await consume("k", cfg, 500)).allowed).toBe(false);
    const freed = await consume("k", cfg, 1001); // entries at t=0 now expired
    expect(freed.allowed).toBe(true);
  });

  it("is exact (not approximate) across a rolling window", async () => {
    await consume("k", cfg, 0);
    await consume("k", cfg, 400);
    await consume("k", cfg, 800);
    // at t=900 all three still in window => blocked
    expect((await consume("k", cfg, 900)).allowed).toBe(false);
    // at t=1100 the t=0 entry expired => one slot
    expect((await consume("k", cfg, 1100)).allowed).toBe(true);
  });
});

describe("sliding-window-counter", () => {
  const cfg: StrategyConfig = { strategy: "sliding-window-counter", limit: 10, windowMs: 1000 };

  it("weights the previous window (smooths the boundary)", async () => {
    // Fill previous window [0,1000) with 10 hits.
    for (let i = 0; i < 10; i++) await consume("k", cfg, 500);
    // At t=1500: prevWeight = 0.5 => estimate = 10*0.5 = 5, so 5 more allowed.
    let allowedCount = 0;
    for (let i = 0; i < 6; i++) {
      if ((await consume("k", cfg, 1500)).allowed) allowedCount++;
    }
    expect(allowedCount).toBe(5);
  });

  it("fully resets after two empty windows", async () => {
    for (let i = 0; i < 10; i++) await consume("k", cfg, 0);
    const r = await consume("k", cfg, 2500); // gap > 1 window
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(9);
  });
});

describe("atomicity (no over-admission under concurrency)", () => {
  it("allows exactly `limit` when many requests race at the same instant", async () => {
    const cfg: StrategyConfig = { strategy: "fixed-window", limit: 5, windowMs: 1000 };
    const results = await Promise.all(
      Array.from({ length: 50 }, () => consume("race", cfg, 0)),
    );
    expect(results.filter((r) => r.allowed).length).toBe(5);
  });
});

describe("clock skew", () => {
  it("never produces negative tokens when time goes backwards", async () => {
    const cfg: StrategyConfig = {
      strategy: "token-bucket",
      capacity: 3,
      refillTokens: 3,
      refillIntervalMs: 3000,
    };
    await consume("k", cfg, 10_000);
    const back = await consume("k", cfg, 0); // earlier than last
    expect(back.remaining).toBeGreaterThanOrEqual(0);
    expect(back.allowed).toBe(true);
  });
});

describe("store housekeeping", () => {
  it("peekWith reads without mutating", async () => {
    const cfg: StrategyConfig = { strategy: "fixed-window", limit: 3, windowMs: 1000 };
    await consume("k", cfg, 0);
    const peek1 = store.peekWith("k", cfg, 0);
    const peek2 = store.peekWith("k", cfg, 0);
    expect(peek1?.remaining).toBe(peek2?.remaining);
  });

  it("reset clears a key", async () => {
    const cfg: StrategyConfig = { strategy: "fixed-window", limit: 1, windowMs: 1000 };
    await consume("k", cfg, 0);
    expect((await consume("k", cfg, 0)).allowed).toBe(false);
    await store.reset("k");
    expect((await consume("k", cfg, 0)).allowed).toBe(true);
  });

  it("evicts least-recently-used beyond maxEntries", async () => {
    const small = new MemoryStore({ maxEntries: 2, sweepIntervalMs: 0 });
    const cfg: StrategyConfig = { strategy: "fixed-window", limit: 5, windowMs: 10_000 };
    await small.consume({ key: "a", config: cfg, cost: 1, now: 0 });
    await small.consume({ key: "b", config: cfg, cost: 1, now: 0 });
    await small.consume({ key: "c", config: cfg, cost: 1, now: 0 }); // evicts "a"
    expect(small.size()).toBe(2);
  });
});
