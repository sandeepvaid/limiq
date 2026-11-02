# Contributing to limiq

Thanks for your interest in contributing! `limiq` is a pnpm monorepo of small, focused packages under the `@limiq/*` scope.

## Prerequisites
- Node.js **>= 20**
- **pnpm** (via Corepack): `corepack enable pnpm`

## Getting started
```bash
git clone https://github.com/sandeepvaid/limiq.git
cd limiq
pnpm install
pnpm build      # tsc -b across all packages
pnpm test       # vitest
pnpm lint
```

## Repository layout
```
packages/
  core/                # @limiq/core — engine, types, strategies' config, resolvers, headers, metrics
  store-memory/        # @limiq/store-memory
  store-redis/         # @limiq/store-redis (client is injected)
  middleware-express/  # @limiq/express
  metrics-prometheus/  # @limiq/prometheus
  dashboard/           # @limiq/dashboard
```
Packages depend on each other via `workspace:*`; `pnpm` links them locally.

## Design rules (please keep these)
- **`core` is framework-agnostic** — never import `express`/`fastify`/etc. in `core`.
- **Stores stay atomic** — one round-trip per decision; the Redis path uses Lua.
- **The Redis client is injected** — never add a hard `redis`/`ioredis` dependency.
- **Fail-open by default** — the limiter must never take down the host API.
- Every strategy has matching tests (happy path + edges: boundary, reset, burst, weighted cost, concurrency, clock skew).

## Tests
- Memory store + core run everywhere.
- Redis-Lua integration tests **auto-skip** unless you provide a live client:
  ```bash
  REDIS_URL=redis://localhost:6379 pnpm test
  ```

## Pull requests
1. Fork and branch from `main` (e.g. `feat/fastify-adapter`, `fix/sliding-log-ttl`).
2. Keep changes focused; add/adjust tests.
3. Ensure `pnpm build && pnpm lint && pnpm test` all pass.
4. Use clear commit messages (Conventional Commits appreciated: `feat:`, `fix:`, `docs:`…).
5. Open the PR against `main` and fill in the template.

## Releasing (maintainers)
```bash
pnpm -r publish --access public
```
`pnpm` rewrites `workspace:*` to real version ranges and publishes in dependency order.

By contributing, you agree your contributions are licensed under the project's **MIT License**.
