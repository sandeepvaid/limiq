# @limiq/core

The framework-agnostic rate limiting engine: 5 strategies (fixed-window, sliding-window-counter, sliding-window-log, token-bucket, leaky-bucket), key resolvers, standard headers, fail-open degradation and a circuit breaker.

Part of the **[@limiq](https://github.com/sandeepvaid/limiq)** rate limiter toolkit — a framework-agnostic, plug-and-play rate limiter for Node.js/TypeScript.

## Install
```bash
npm install @limiq/core
```

See the [project README](https://github.com/sandeepvaid/limiq#readme) for full usage. You also need a store (`@limiq/store-memory` or `@limiq/store-redis`).

## License
MIT © Sandeep Vaid
