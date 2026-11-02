/**
 * Minimal Redis client surface the store needs. Shaped after ioredis (the
 * common case). Any client exposing these methods can be injected — ioredis,
 * a cluster client, or a thin wrapper over node-redis. The library itself has
 * NO redis dependency: the consumer owns and injects the client.
 */
export interface RedisLike {
  evalsha(
    sha: string,
    numkeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
  eval(
    script: string,
    numkeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
  /** SCRIPT LOAD; returns the sha. Optional — EVAL is used when absent. */
  script?(subcommand: "load", script: string): Promise<unknown>;
  /** Optional health probe. */
  ping?(): Promise<unknown>;
  /** Optional, used by reset(). */
  del?(...keys: string[]): Promise<unknown>;
}

function isNoScriptError(err: unknown): boolean {
  return (
    err instanceof Error && err.message.toUpperCase().includes("NOSCRIPT")
  );
}

/** Caches a script's SHA and runs it via EVALSHA, falling back to EVAL. */
export class LuaScript {
  private sha: string | undefined;

  constructor(private readonly source: string) {}

  async run(
    client: RedisLike,
    keys: string[],
    args: Array<string | number>,
  ): Promise<unknown> {
    const numkeys = keys.length;
    const flat = [...keys, ...args];

    if (client.script) {
      if (!this.sha) {
        this.sha = (await client.script("load", this.source)) as string;
      }
      try {
        return await client.evalsha(this.sha, numkeys, ...flat);
      } catch (err) {
        if (isNoScriptError(err)) {
          this.sha = (await client.script("load", this.source)) as string;
          return await client.evalsha(this.sha, numkeys, ...flat);
        }
        throw err;
      }
    }
    return await client.eval(this.source, numkeys, ...flat);
  }
}
