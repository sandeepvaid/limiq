import type {
  Clock,
  MetricsCollector,
  MetricsEvent,
  MetricsSnapshot,
} from "./types.js";
import { systemClock } from "./clock.js";

export interface MetricsOptions {
  /** Max distinct keys tracked for "top throttled" (bounded). Default 1000. */
  maxTrackedKeys?: number;
  /** Size of the rolling latency reservoir. Default 2048. */
  latencyReservoir?: number;
  /** How many top entries `snapshot()` returns. Default 10. */
  topN?: number;
  clock?: Clock;
}

/**
 * Default in-process metrics collector.
 *
 * Counters are cumulative-since-reset (monotonic — Prometheus-friendly). The
 * hot path (`record`/`recordStoreError`) is O(1), synchronous and non-throwing.
 * Memory is bounded: a fixed latency ring buffer + a capped top-key map.
 */
export class DefaultMetricsCollector implements MetricsCollector {
  private readonly maxKeys: number;
  private readonly reservoirSize: number;
  private readonly topN: number;
  private readonly clock: Clock;

  private since: number;
  private allowed = 0;
  private blocked = 0;
  private degraded = 0;
  private storeErrors = 0;

  private readonly byRoute = new Map<
    string,
    { allowed: number; blocked: number }
  >();
  private readonly blockedByKey = new Map<string, number>();

  private readonly latencies: number[];
  private latIdx = 0;
  private latCount = 0;

  constructor(options: MetricsOptions = {}) {
    this.maxKeys = options.maxTrackedKeys ?? 1000;
    this.reservoirSize = options.latencyReservoir ?? 2048;
    this.topN = options.topN ?? 10;
    this.clock = options.clock ?? systemClock;
    this.since = this.clock.now();
    this.latencies = new Array<number>(this.reservoirSize).fill(0);
  }

  record(event: MetricsEvent): void {
    const { decision, route } = event;

    if (decision.allowed) this.allowed++;
    else this.blocked++;
    if (decision.degraded) this.degraded++;

    let r = this.byRoute.get(route);
    if (!r) {
      r = { allowed: 0, blocked: 0 };
      this.byRoute.set(route, r);
    }
    if (decision.allowed) r.allowed++;
    else r.blocked++;

    if (!decision.allowed) this.trackBlockedKey(decision.key);

    // Ring-buffer the latency sample.
    this.latencies[this.latIdx] = decision.evaluationMs;
    this.latIdx = (this.latIdx + 1) % this.reservoirSize;
    if (this.latCount < this.reservoirSize) this.latCount++;
  }

  recordStoreError(): void {
    this.storeErrors++;
  }

  private trackBlockedKey(key: string): void {
    const current = this.blockedByKey.get(key);
    if (current !== undefined) {
      this.blockedByKey.set(key, current + 1);
      return;
    }
    if (this.blockedByKey.size >= this.maxKeys) {
      // Bounded: evict the current minimum to make room.
      let minKey: string | undefined;
      let minVal = Infinity;
      for (const [k, v] of this.blockedByKey) {
        if (v < minVal) {
          minVal = v;
          minKey = k;
        }
      }
      if (minKey !== undefined) this.blockedByKey.delete(minKey);
    }
    this.blockedByKey.set(key, 1);
  }

  private percentiles(): MetricsSnapshot["latency"] {
    const n = this.latCount;
    if (n === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
    const sample = this.latencies.slice(0, n).sort((a, b) => a - b);
    const at = (p: number): number => {
      const idx = Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1));
      return sample[idx] ?? 0;
    };
    return { p50: at(0.5), p95: at(0.95), p99: at(0.99), count: n };
  }

  snapshot(): MetricsSnapshot {
    const byRoute: MetricsSnapshot["byRoute"] = {};
    for (const [route, v] of this.byRoute) {
      byRoute[route] = { allowed: v.allowed, blocked: v.blocked };
    }
    const topThrottled = [...this.blockedByKey.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.topN)
      .map(([key, blocked]) => ({ key, blocked }));

    return {
      windowMs: this.clock.now() - this.since,
      since: this.since,
      counters: {
        allowed: this.allowed,
        blocked: this.blocked,
        degraded: this.degraded,
        storeErrors: this.storeErrors,
      },
      byRoute,
      latency: this.percentiles(),
      topThrottled,
    };
  }

  reset(): void {
    this.since = this.clock.now();
    this.allowed = 0;
    this.blocked = 0;
    this.degraded = 0;
    this.storeErrors = 0;
    this.byRoute.clear();
    this.blockedByKey.clear();
    this.latIdx = 0;
    this.latCount = 0;
  }
}
