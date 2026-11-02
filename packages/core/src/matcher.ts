import type { RateLimitContext, Rule, RuleMatch } from "./types.js";

/** Convert a glob with `*` (within a segment) and `**` (across segments). */
function globToRegExp(glob: string): RegExp {
  // Split on `**` first so each remaining segment only expands single `*`.
  const pattern = glob
    .split("**")
    .map((segment) =>
      segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${pattern}$`);
}

function matchOne(match: RuleMatch, ctx: RateLimitContext): boolean {
  if (match.method && match.method !== ctx.method) return false;
  if (match.path) {
    const re = globToRegExp(match.path);
    if (!re.test(ctx.path)) return false;
  }
  if (match.predicate && !match.predicate(ctx)) return false;
  return true;
}

/**
 * First-match-wins rule selection (LOCKED v1). Returns the matched rule, or
 * `undefined` when none match (caller falls back to defaults).
 */
export function matchRule(
  rules: readonly Rule[],
  ctx: RateLimitContext,
): Rule | undefined {
  for (const rule of rules) {
    if (matchOne(rule.match, ctx)) return rule;
  }
  return undefined;
}
