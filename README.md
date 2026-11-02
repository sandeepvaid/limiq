# Rate Limiter Library

A framework-agnostic, plug-and-play **rate limiter** for Node.js/TypeScript, with a lightweight **observability dashboard** and a **Prometheus** exporter.

- **Framework-agnostic core** — no `express`/`fastify` imports in the engine.
- **5 strategies** by name: `fixed-window`, `sliding-window-counter`, `sliding-window-log`, `token-bucket`, `leaky-bucket`.
- **Pluggable stores** — in-memory (dev/test/fallback) and Redis (atomic Lua, one round-trip). The **Redis client is injected** — the library has no redis dependency.
- **Fail-open with degradation** + circuit breaker, so the limiter never takes down your API.
- **Standard headers** — draft-7 `RateLimit-*` + `Retry-After`.
- **Metrics** — bounded in-process aggregates → dashboard JSON API + embedded UI + Prometheus text.

> Status: early release (`0.1.0`). Core engine, all 5 strategies, memory + Redis stores, Express adapter, Prometheus exporter and the embedded dashboard are built and tested. Fastify/Nest adapters are on the roadmap.

## Packages

| Package | What it is |
|---|---|
| `@limiq/core` | Engine, types, strategies' config, resolvers, headers, metrics |
| `@limiq/store-memory` | In-memory store (Map + LRU + TTL); the 5 algorithms as pure functions |
| `@limiq/store-redis` | Redis store (atomic Lua); **inject your own client** |
| `@limiq/express` | Express middleware adapter (thin, structural types) |
| `@limiq/prometheus` | Prometheus exposition for the metrics snapshot |
| `@limiq/dashboard` | Framework-agnostic dashboard router + embedded UI + Express mount |

## Quick start (Express + memory store)

```ts
import { createRateLimiter, byIp } from "@limiq/core";
import { MemoryStore } from "@limiq/store-memory";
import { expressRateLimit } from "@limiq/express";

const limiter = createRateLimiter({
  store: new MemoryStore(),
  keyResolver: byIp,
  defaults: { strategy: "token-bucket", capacity: 100, refillTokens: 100, refillIntervalMs: 60_000 },
  rules: [
    { match: { method: "POST", path: "/auth/*" },
      strategy: "fixed-window", limit: 5, windowMs: 60_000, onStoreError: "fail-closed" },
  ],
});

app.use(expressRateLimit(limiter));
```

## Production (inject a Redis client)

The library never creates or owns a Redis connection — you inject any ioredis-compatible client.

```ts
import Redis from "ioredis";
import { RedisStore } from "@limiq/store-redis";
import { MemoryStore } from "@limiq/store-memory";

const client = new Redis(process.env.REDIS_URL!);

const limiter = createRateLimiter({
  store: new RedisStore({ client }),
  fallbackStore: new MemoryStore(),   // used when onStoreError is 'local-fallback'
  onStoreError: "local-fallback",     // 'fail-open' | 'fail-closed' | 'local-fallback'
  keyPrefix: "ledger",
  defaults: { strategy: "sliding-window-counter", limit: 60, windowMs: 60_000 },
});
```

Keys are namespaced `rl:{prefix}:{strategy}:{partition}` with a cluster hash-tag and TTLs.

## Dashboard + Prometheus

```ts
import { expressDashboard } from "@limiq/dashboard";
import { prometheusHandler } from "@limiq/prometheus";

const metrics = limiter.getMetrics()!;
app.use(expressDashboard({ collector: metrics, limiter, isAdmin: (req) => /* your auth */ false }));
app.get("/metrics", prometheusHandler(metrics));
// UI at /__ratelimit/ , JSON at /__ratelimit/api/metrics
```

The library exposes **aggregates, not per-request records**, and holds only a small in-memory rolling window — scrapers (Prometheus) own long-term persistence and cross-instance aggregation.

## Strategies

| Strategy | Config |
|---|---|
| `fixed-window` | `limit`, `windowMs` |
| `sliding-window-counter` | `limit`, `windowMs` |
| `sliding-window-log` | `limit`, `windowMs` |
| `token-bucket` | `capacity`, `refillTokens`, `refillIntervalMs` |
| `leaky-bucket` | `capacity`, `leakRatePerSec` |

All strategies support a weighted `cost` per request (via `cost: (ctx) => number`).

## Key resolvers

`byIp`, `byUserId`, `byApiKey`, `byRoute`, and `composite(...)` — or any `(ctx) => string | Promise<string>`.

## Development

```bash
pnpm install
pnpm build       # tsc -b across all packages
pnpm test        # vitest (memory + core + adapters + redis adapter tests)
pnpm lint
```

Redis-Lua correctness tests are integration tests that **auto-skip** unless you provide a live client (set `REDIS_URL` and have `ioredis` installed) — keeping the library redis-dependency-free.
```bash
REDIS_URL=redis://localhost:6379 pnpm test
```
