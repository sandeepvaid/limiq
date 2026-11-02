/** Thrown when limiter configuration is invalid (at creation time). */
export class RateLimitConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitConfigError";
  }
}

/** Wraps an underlying store failure so the engine can apply degradation. */
export class RateLimitStoreError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "RateLimitStoreError";
  }
}
