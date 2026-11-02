# @limiq/express

Express middleware adapter for @limiq/core. Thin, structural types — no express dependency.

Part of the **[@limiq](https://github.com/sandeepvaid/limiq)** rate limiter toolkit — a framework-agnostic, plug-and-play rate limiter for Node.js/TypeScript.

## Install
```bash
npm install @limiq/express
```

```ts
import { expressRateLimit } from '@limiq/express';
app.use(expressRateLimit(limiter));
```

## License
MIT © Sandeep Vaid
