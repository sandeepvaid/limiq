export type CircuitState = "closed" | "open" | "half-open";

/**
 * Minimal circuit breaker for the store path. After `threshold` consecutive
 * failures it opens; after `cooldownMs` it allows a single half-open probe. A
 * success closes it; a failure re-opens it.
 */
export class CircuitBreaker {
  private failures = 0;
  private state: CircuitState = "closed";
  private openedAt = 0;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
  ) {}

  /** True if a request may hit the primary store right now. */
  canRequest(now: number): boolean {
    if (this.state === "open") {
      if (now - this.openedAt >= this.cooldownMs) {
        this.state = "half-open";
        return true;
      }
      return false;
    }
    return true; // closed or half-open
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  recordFailure(now: number): void {
    this.failures++;
    if (this.state === "half-open" || this.failures >= this.threshold) {
      this.state = "open";
      this.openedAt = now;
    }
  }

  get currentState(): CircuitState {
    return this.state;
  }
}
