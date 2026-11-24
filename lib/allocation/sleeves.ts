/**
 * Ladder position tagging (Phase 3) — the ONE definition of "is this paper
 * position a strategy (Explore) position, or a Core / Safety holding?".
 *
 * Core and Tier 1 Safety holdings are ordinary paper_positions rows carrying a
 * RESERVED strategy_key. Reserved keys (rather than a new column) mean the tag
 * works whether or not a migration has been applied: a filter on a missing
 * column would make strategy queries fail and see "no positions", which fails
 * OPEN for the Explore cap and kill switch.
 *
 * Rules every reader follows:
 *   strategy-level (learning, scorecards, promotion, lifecycle, exits,
 *   kill switch, book/correlation/Explore exposure)  → excludeLadder()
 *   account-level (total value, since-start, mark-to-market) → include all
 */

export const CORE_STRATEGY_KEY = 'core'
export const SAFETY_STRATEGY_KEY = 'safety'
export const LADDER_STRATEGY_KEYS = [CORE_STRATEGY_KEY, SAFETY_STRATEGY_KEY] as const

export type LadderSleeve = 'core' | 'safety'

/** PostgREST list literal for `.not('strategy_key', 'in', …)`. */
export const LADDER_KEYS_FILTER = `(${LADDER_STRATEGY_KEYS.map(k => `"${k}"`).join(',')})`

export function isLadderKey(strategyKey: string | null | undefined): boolean {
  return strategyKey === CORE_STRATEGY_KEY || strategyKey === SAFETY_STRATEGY_KEY
}

export function sleeveOfKey(strategyKey: string | null | undefined): 'explore' | LadderSleeve {
  if (strategyKey === CORE_STRATEGY_KEY) return 'core'
  if (strategyKey === SAFETY_STRATEGY_KEY) return 'safety'
  return 'explore'
}

/** Add to any paper_positions query that should see STRATEGY (Explore) rows only. */
export function excludeLadder<Q extends { not: (column: string, operator: string, value: string) => Q }>(q: Q): Q {
  return q.not('strategy_key', 'in', LADDER_KEYS_FILTER)
}

/** In-memory equivalent, for rows already fetched with strategy_key. */
export function strategyRowsOnly<T extends { strategy_key?: string | null }>(rows: T[]): T[] {
  return rows.filter(r => !isLadderKey(r.strategy_key))
}

/**
 * Exit thresholds stamped on ladder rows — a second seatbelt behind the
 * explicit exclusions: no stop, target, or timeout can ever fire on them.
 */
export const LADDER_NO_EXIT = {
  stop_loss_pct: 1,              // a 100% loss — unreachable for a long fund
  take_profit_pct: 1_000_000,
  max_hold_hours: 2_000_000_000, // ~228,000 years (fits a Postgres integer)
} as const
