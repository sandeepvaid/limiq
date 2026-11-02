import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { StrategyConfig } from "@limiq/core";
import { RedisStore, type RedisLike } from "../src/index.js";

/**
 * Real-Lua integration tests. These are NOT a library responsibility to run in
 * CI (the client is injected), so they auto-skip unless the consumer provides a
 * live client: set REDIS_URL and have `ioredis` importable. Otherwise skipped.
 */
const REDIS_URL = process.env.REDIS_URL;

let client: RedisLike | undefined;
let ioredisAvailable = false;

beforeAll(async () => {
  if (!REDIS_URL) return;
  try {
    const mod = (await import("ioredis")) as { default: new (url: string) => RedisLike };
    client = new mod.default(REDIS_URL);
    ioredisAvailable = true;
  } catch {
    ioredisAvailable = false;
  }
});

afterAll(async () => {
  const c = client as unknown as { quit?: () => Promise<unknown> } | undefined;
  await c?.quit?.();
});

const run = REDIS_URL ? describe : describe.skip;

run("RedisStore against a live Redis", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it.runIf(ioredisAvailable)("enforces fixed-window exactly under concurrency", async () => {
    const store = new RedisStore({ client: client! });
    const cfg: StrategyConfig = { strategy: "fixed-window", limit: 5, windowMs: 2000 };
    const key = `rl:test:${Date.now()}`;
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        store.consume({ key, config: cfg, cost: 1, now: Date.now() }),
      ),
    );
    expect(results.filter((r) => r.allowed).length).toBe(5);
  });

  it.runIf(ioredisAvailable)("refills a token-bucket over time", async () => {
    const store = new RedisStore({ client: client! });
    const cfg: StrategyConfig = {
      strategy: "token-bucket",
      capacity: 2,
      refillTokens: 10,
      refillIntervalMs: 1000,
    };
    const key = `rl:tb:${Date.now()}`;
    await store.consume({ key, config: cfg, cost: 1, now: Date.now() });
    await store.consume({ key, config: cfg, cost: 1, now: Date.now() });
    const blocked = await store.consume({ key, config: cfg, cost: 1, now: Date.now() });
    expect(blocked.allowed).toBe(false);
    await sleep(250); // ~2.5 tokens refill
    const after = await store.consume({ key, config: cfg, cost: 1, now: Date.now() });
    expect(after.allowed).toBe(true);
  });
});
