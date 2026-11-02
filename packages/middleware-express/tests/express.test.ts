import { describe, it, expect } from "vitest";
import { createRateLimiter } from "@limiq/core";
import { MemoryStore } from "@limiq/store-memory";
import {
  expressRateLimit,
  type ExpressRequestLike,
  type ExpressResponseLike,
} from "../src/index.js";

function makeReq(over: Partial<ExpressRequestLike> = {}): ExpressRequestLike {
  return {
    ip: "9.9.9.9",
    method: "GET",
    path: "/x",
    headers: {},
    ...over,
  };
}

function makeRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: unknown;
  const res: ExpressResponseLike & {
    _headers: Record<string, string>;
    _status: () => number;
    _body: () => unknown;
  } = {
    setHeader(name, value) {
      headers[name] = value;
    },
    status(code) {
      statusCode = code;
      return res;
    },
    json(b) {
      body = b;
    },
    _headers: headers,
    _status: () => statusCode,
    _body: () => body,
  };
  return res;
}

const limiterWith = (limit: number) =>
  createRateLimiter({
    store: new MemoryStore({ sweepIntervalMs: 0 }),
    defaults: { strategy: "fixed-window", limit, windowMs: 10_000 },
  });

describe("expressRateLimit", () => {
  it("calls next() and sets headers when allowed", async () => {
    const mw = expressRateLimit(limiterWith(2));
    const res = makeRes();
    let nexted = false;
    await new Promise<void>((resolve) => {
      mw(makeReq(), res, () => {
        nexted = true;
        resolve();
      });
    });
    expect(nexted).toBe(true);
    expect(res._headers["RateLimit-Limit"]).toBe("2");
    expect(res._headers["RateLimit-Remaining"]).toBe("1");
  });

  it("sends 429 with Retry-After when blocked", async () => {
    const mw = expressRateLimit(limiterWith(1));
    // First request consumes the only slot.
    await new Promise<void>((r) => mw(makeReq(), makeRes(), () => r()));
    const res = makeRes();
    let nexted = false;
    await new Promise<void>((resolve) => {
      // onBlocked not provided -> default path; next not called.
      mw(makeReq(), res, () => {
        nexted = true;
      });
      setTimeout(resolve, 10);
    });
    expect(nexted).toBe(false);
    expect(res._status()).toBe(429);
    expect(res._headers["Retry-After"]).toBeDefined();
    expect((res._body() as { error: string }).error).toBe("Too Many Requests");
  });

  it("uses contextExtras for partitioning (per-user)", async () => {
    const limiter = createRateLimiter({
      store: new MemoryStore({ sweepIntervalMs: 0 }),
      keyResolver: (ctx) => (ctx.userId ? `user:${ctx.userId}` : `ip:${ctx.ip}`),
      defaults: { strategy: "fixed-window", limit: 1, windowMs: 10_000 },
    });
    const mw = expressRateLimit(limiter, {
      contextExtras: (req) => ({ userId: String(req.headers["x-user"]) }),
    });
    const callFor = (user: string) => {
      const res = makeRes();
      return new Promise<ExpressResponseLike & { _status: () => number }>((resolve) => {
        const r = res as ExpressResponseLike & { _status: () => number };
        mw(makeReq({ headers: { "x-user": user } }), res, () => resolve(r));
        setTimeout(() => resolve(r), 10);
      });
    };
    expect((await callFor("alice"))._status()).toBe(200);
    expect((await callFor("bob"))._status()).toBe(200); // different user, allowed
    expect((await callFor("alice"))._status()).toBe(429); // alice over limit
  });

  it("honours a custom onBlocked handler", async () => {
    const mw = expressRateLimit(limiterWith(0 + 1), {
      onBlocked: (_req, res) => {
        res.status(503).json({ custom: true });
      },
    });
    await new Promise<void>((r) => mw(makeReq(), makeRes(), () => r()));
    const res = makeRes();
    await new Promise<void>((resolve) => {
      mw(makeReq(), res, () => undefined);
      setTimeout(resolve, 10);
    });
    expect(res._status()).toBe(503);
    expect((res._body() as { custom: boolean }).custom).toBe(true);
  });
});
