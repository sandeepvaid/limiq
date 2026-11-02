import { describe, it, expect } from "vitest";
import type { StrategyConfig } from "@limiq/core";
import { RedisStore, type RedisLike } from "../src/index.js";

interface Call {
  sha?: string;
  numkeys: number;
  args: Array<string | number>;
}

class FakeRedis implements RedisLike {
  evalshaCalls: Call[] = [];
  evalCalls: Call[] = [];
  scriptLoads = 0;
  delCalls: string[][] = [];
  failNoScriptOnce = false;
  private failed = false;

  constructor(
    private reply: unknown,
    private readonly opts: { withScript?: boolean } = { withScript: true },
  ) {
    if (!this.opts.withScript) {
      // Remove the optional script method to exercise the EVAL path.
      (this as { script?: unknown }).script = undefined;
    }
  }

  script = async (_sub: "load", _src: string): Promise<unknown> => {
    this.scriptLoads++;
    return `sha-${this.scriptLoads}`;
  };

  async evalsha(
    sha: string,
    numkeys: number,
    ...args: Array<string | number>
  ): Promise<unknown> {
    if (this.failNoScriptOnce && !this.failed) {
      this.failed = true;
      throw new Error("NOSCRIPT No matching script. Please use EVAL.");
    }
    this.evalshaCalls.push({ sha, numkeys, args });
    return this.reply;
  }

  async eval(
    _script: string,
    numkeys: number,
    ...args: Array<string | number>
  ): Promise<unknown> {
    this.evalCalls.push({ numkeys, args });
    return this.reply;
  }

  async ping(): Promise<unknown> {
    return "PONG";
  }

  async del(...keys: string[]): Promise<unknown> {
    this.delCalls.push(keys);
    return keys.length;
  }
}

const fixed: StrategyConfig = { strategy: "fixed-window", limit: 5, windowMs: 1000 };

describe("RedisStore reply mapping", () => {
  it("maps an allowed reply", async () => {
    const client = new FakeRedis([1, 5, 4, 1000, 0]);
    const store = new RedisStore({ client });
    const r = await store.consume({ key: "rl:x", config: fixed, cost: 1, now: 0 });
    expect(r).toEqual({ allowed: true, limit: 5, remaining: 4, resetMs: 1000 });
  });

  it("maps a blocked reply with retryAfter", async () => {
    const client = new FakeRedis([0, 5, 0, 600, 600]);
    const store = new RedisStore({ client });
    const r = await store.consume({ key: "rl:x", config: fixed, cost: 1, now: 0 });
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBe(600);
  });

  it("throws on a malformed reply", async () => {
    const client = new FakeRedis([1, 2]);
    const store = new RedisStore({ client });
    await expect(
      store.consume({ key: "k", config: fixed, cost: 1, now: 0 }),
    ).rejects.toThrow();
  });
});

describe("RedisStore ARGV construction", () => {
  it("passes KEYS + [limit, windowMs, cost] for fixed-window", async () => {
    const client = new FakeRedis([1, 5, 4, 1000, 0]);
    const store = new RedisStore({ client });
    await store.consume({ key: "rl:fw", config: fixed, cost: 2, now: 0 });
    const call = client.evalshaCalls[0]!;
    expect(call.numkeys).toBe(1);
    expect(call.args).toEqual(["rl:fw", 5, 1000, 2]);
  });

  it("passes capacity/refill args for token-bucket", async () => {
    const client = new FakeRedis([1, 3, 2, 1000, 0]);
    const store = new RedisStore({ client });
    const cfg: StrategyConfig = {
      strategy: "token-bucket",
      capacity: 3,
      refillTokens: 3,
      refillIntervalMs: 3000,
    };
    await store.consume({ key: "rl:tb", config: cfg, cost: 1, now: 0 });
    expect(client.evalshaCalls[0]!.args).toEqual(["rl:tb", 3, 3, 3000, 1]);
  });

  it("appends a unique request id for sliding-window-log", async () => {
    const client = new FakeRedis([1, 5, 4, 1000, 0]);
    const store = new RedisStore({ client });
    const cfg: StrategyConfig = {
      strategy: "sliding-window-log",
      limit: 5,
      windowMs: 1000,
    };
    await store.consume({ key: "rl:log", config: cfg, cost: 1, now: 0 });
    const args = client.evalshaCalls[0]!.args;
    expect(args.slice(0, 4)).toEqual(["rl:log", 5, 1000, 1]);
    expect(typeof args[4]).toBe("string"); // uuid
  });
});

describe("RedisStore script lifecycle", () => {
  it("reloads the script and retries on NOSCRIPT", async () => {
    const client = new FakeRedis([1, 5, 4, 1000, 0]);
    client.failNoScriptOnce = true;
    const store = new RedisStore({ client });
    const r = await store.consume({ key: "k", config: fixed, cost: 1, now: 0 });
    expect(r.allowed).toBe(true);
    expect(client.scriptLoads).toBe(2); // initial load + reload after NOSCRIPT
  });

  it("falls back to EVAL when the client has no script method", async () => {
    const client = new FakeRedis([1, 5, 4, 1000, 0], { withScript: false });
    const store = new RedisStore({ client });
    await store.consume({ key: "k", config: fixed, cost: 1, now: 0 });
    expect(client.evalCalls.length).toBe(1);
    expect(client.evalshaCalls.length).toBe(0);
  });
});

describe("RedisStore admin ops", () => {
  it("healthcheck returns true on PONG", async () => {
    const store = new RedisStore({ client: new FakeRedis([1, 1, 1, 1, 0]) });
    expect(await store.healthcheck()).toBe(true);
  });

  it("reset deletes the key", async () => {
    const client = new FakeRedis([1, 1, 1, 1, 0]);
    const store = new RedisStore({ client });
    await store.reset("rl:x");
    expect(client.delCalls[0]).toEqual(["rl:x"]);
  });

  it("requires an injected client", () => {
    // @ts-expect-error intentionally missing client
    expect(() => new RedisStore({})).toThrow();
  });
});
