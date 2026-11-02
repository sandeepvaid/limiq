import type { Clock } from "./types.js";

/** Default system clock. */
export const systemClock: Clock = {
  now: () => Date.now(),
};
