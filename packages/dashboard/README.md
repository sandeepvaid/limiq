# @limiq/dashboard

Lightweight embedded metrics dashboard + JSON API for @limiq/core. Single-file UI, framework-agnostic router + Express mount.

Part of the **[@limiq](https://github.com/sandeepvaid/limiq)** rate limiter toolkit — a framework-agnostic, plug-and-play rate limiter for Node.js/TypeScript.

## Install
```bash
npm install @limiq/dashboard
```

```ts
import { expressDashboard } from '@limiq/dashboard';
app.use(expressDashboard({ collector: limiter.getMetrics(), limiter }));
// UI at /__ratelimit/
```

## License
MIT © Sandeep Vaid
