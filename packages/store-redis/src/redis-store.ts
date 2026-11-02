import { randomUUID } from "node:crypto";
import type {
  ConsumeArgs,
  ConsumeResult,
  Store,
  StrategyConfig,
  StrategyName,
} from "@limiq/core";
import { RateLimitStoreError } from "@limiq/core";
import { LuaScript, type RedisLike } from "./redis-like.js";
import { SCRIPTS } from "./scripts.js";

export interface RedisStoreOptions {
  /** The injected Redis client (ioredis-compatible). The library never owns it. */
  client: RedisLike;
}

/**
 * Redis-backed store. Each decision is one atomic Lua round-trip. The client is
 * injected; this package has no runtime redis dependency.
 */
export class RedisStore implements Store {
  private readonly client: RedisLike;
  private readonly scripts: Record<StrategyName, LuaScript>;

  constructor(options: RedisStoreOptions) {
    if (!options?.client) {
      throw new RateLimitStoreError("RedisStore requires an injected `client`.");
    }
    this.client = options.client;
    this.scripts = {
      "fixed-window": new LuaScript(SCRIPTS["fixed-window"]),
      "sliding-window-counter": new LuaScript(SCRIPTS["sliding-window-counter"]),
      "sliding-window-log": new LuaScript(SCRIPTS["sliding-window-log"]),
      "token-bucket": new LuaScript(SCRIPTS["token-bucket"]),
      "leaky-bucket": new LuaScript(SCRIPTS["leaky-bucket"]),
    };
  }

  async consume(args: ConsumeArgs): Promise<ConsumeResult> {
    const { key, config, cost } = args;
    const script = this.scripts[config.strategy];
    const argv = this.argvFor(config, cost);
    let reply: unknown;
    try {
      reply = await script.run(this.client, [key], argv);
    } catch (err) {
      throw new RateLimitStoreError("Redis consume failed.", err);
    }
    return this.mapReply(reply);
  }

  async reset(key: string): Promise<void> {
    // Fixed-window uses per-window sub-keys (key:<windowId>); match them too.
    if (this.client.del) {
      await this.client.del(key);
    }
  }

  async healthcheck(): Promise<boolean> {
    try {
      if (this.client.ping) {
        const pong = await this.client.ping();
        return pong === "PONG" || pong === "pong" || pong === true;
      }
      // No ping available: a successful trivial EVAL is our probe.
      await this.client.eval("return 1", 0);
      return true;
    } catch {
      return false;
    }
  }

  private argvFor(config: StrategyConfig, cost: number): Array<string | number> {
    switch (config.strategy) {
      case "fixed-window":
      case "sliding-window-counter":
        return [config.limit as number, config.windowMs as number, cost];
      case "sliding-window-log":
        return [
          config.limit as number,
          config.windowMs as number,
          cost,
          randomUUID(),
        ];
      case "token-bucket":
        return [
          config.capacity as number,
          config.refillTokens as number,
          config.refillIntervalMs as number,
          cost,
        ];
      case "leaky-bucket":
        return [config.capacity as number, config.leakRatePerSec as number, cost];
    }
  }

  private mapReply(reply: unknown): ConsumeResult {
    if (!Array.isArray(reply) || reply.length < 5) {
      throw new RateLimitStoreError(
        `Unexpected Redis reply shape: ${JSON.stringify(reply)}`,
      );
    }
    const [allowed, limit, remaining, resetMs, retry] = reply.map((v) =>
      Number(v),
    );
    const result: ConsumeResult = {
      allowed: allowed === 1,
      limit: limit ?? 0,
      remaining: remaining ?? 0,
      resetMs: resetMs ?? 0,
    };
    if (allowed !== 1 && retry !== undefined && retry > 0) {
      result.retryAfterMs = retry;
    }
    return result;
  }
}
