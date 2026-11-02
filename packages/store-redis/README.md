# @limiq/store-redis

Redis store for @limiq/core — atomic Lua scripts, one round-trip per decision. The Redis client is **injected**; this package has no redis dependency.

Part of the **[@limiq](https://github.com/sandeepvaid/limiq)** rate limiter toolkit — a framework-agnostic, plug-and-play rate limiter for Node.js/TypeScript.

## Install
```bash
npm install @limiq/store-redis
```

```ts
import Redis from 'ioredis';
import { RedisStore } from '@limiq/store-redis';
const store = new RedisStore({ client: new Redis(process.env.REDIS_URL) });
```

## License
MIT © Sandeep Vaid
