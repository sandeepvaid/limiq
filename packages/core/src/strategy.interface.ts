import type { ConsumeArgs, ConsumeResult, StrategyName } from "./types.js";

/**
 * A strategy is the pure algorithm contract. Implementations defer the actual
 * atomic mutation to the store (Lua on redis, pure-fn on memory), so the
 * strategy layer stays store-agnostic. Bodies land in Phase 1+.
 */
export interface Strategy {
  readonly name: StrategyName;
  /** Validate this strategy's required config fields; throw on invalid. */
  validate(config: unknown): void;
  /** Evaluate one request atomically via the bound store. */
  consume(args: ConsumeArgs): Promise<ConsumeResult>;
}
