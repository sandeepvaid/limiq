# @limiq/prometheus

Prometheus exposition for @limiq/core metrics. No prom-client dependency.

Part of the **[@limiq](https://github.com/sandeepvaid/limiq)** rate limiter toolkit — a framework-agnostic, plug-and-play rate limiter for Node.js/TypeScript.

## Install
```bash
npm install @limiq/prometheus
```

```ts
import { prometheusHandler } from '@limiq/prometheus';
app.get('/metrics', prometheusHandler(limiter.getMetrics()));
```

## License
MIT © Sandeep Vaid
