# @limiq/store-memory

In-memory store for @limiq/core (Map + LRU + TTL). Single-process — ideal for dev/test and as a fail-open fallback.

Part of the **[@limiq](https://github.com/sandeepvaid/limiq)** rate limiter toolkit — a framework-agnostic, plug-and-play rate limiter for Node.js/TypeScript.

## Install
```bash
npm install @limiq/store-memory
```

```ts
import { createRateLimiter } from '@limiq/core';
import { MemoryStore } from '@limiq/store-memory';
const limiter = createRateLimiter({ store: new MemoryStore(), defaults: { strategy: 'token-bucket', capacity: 100, refillTokens: 100, refillIntervalMs: 60000 } });
```

## License
MIT © Sandeep Vaid
