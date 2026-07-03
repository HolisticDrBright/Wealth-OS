/**
 * Strategy lifecycle discipline (Remaining brief R6) — funds fire strategies;
 * apps hoard them. Weekly review: rolling performance vs the sleeve's
 * declared PASSIVE benchmark; two consecutive failing quarters → automatic
 * demotion (live→paper, paper→shadow) with a filed report. Pure thresholds —
 * no LLM discretion in demotion. Re-promotion only through the normal gates.
 */

export const PASSIVE_BENCHMARKS: Record<string, { symbol: string; description: string }> = {
  stocks:       { symbol: 'SPY',     description: 'S&P 500 buy-and-hold' },
  options:      { symbol: 'SPY',     description: 'S&P 500 buy-and-hold' },
  crypto:       { symbol: 'BTC-USD', description: 'Bitcoin buy-and-hold' },
  forex:        { symbol: 'UUP',     description: 'Dollar-carry hold' },
  polymarket:   { symbol: 'HOLD_NO', description: 'Buy-NO baseline (nothing-ever-happens)' },
  'multi-asset': { symbol: 'SPY',    description: 'S&P 500 buy-and-hold' },
}

export interface QuarterPerformance {
  /** e.g. '2026-Q1' — must be a COMPLETE quarter. */
  quarter: string
  strategyReturnPct: number   // net of modeled costs
  benchmarkReturnPct: number
  trades: number
}

export interface LifecycleVerdict {
  strategyKey: string
  failingQuarters: string[]
  demote: boolean
  report: string
}

export const MIN_TRADES_PER_QUARTER = 5

/**
 * Demote when the TWO most recent complete quarters (with enough trades)
 * both underperform the passive benchmark net of costs.
 */
export function evaluateLifecycle(
  strategyKey: string,
  quarters: QuarterPerformance[]
): LifecycleVerdict {
  const evaluable = quarters
    .filter(q => q.trades >= MIN_TRADES_PER_QUARTER)
    .sort((a, b) => a.quarter.localeCompare(b.quarter))

  const failing = evaluable.filter(q => q.strategyReturnPct < q.benchmarkReturnPct)
  const lastTwo = evaluable.slice(-2)
  const demote =
    lastTwo.length === 2 &&
    lastTwo.every(q => q.strategyReturnPct < q.benchmarkReturnPct)

  const report = demote
    ? `${strategyKey}: demoted — trailed ${lastTwo.map(q =>
        `${q.quarter} (${q.strategyReturnPct.toFixed(1)}% vs ${q.benchmarkReturnPct.toFixed(1)}%)`
      ).join(' and ')}. Capital returns to the index core; re-promotion only through the normal gates.`
    : `${strategyKey}: healthy — ${evaluable.length} evaluable quarter(s), ${failing.length} below benchmark (need 2 consecutive to demote).`

  return {
    strategyKey,
    failingQuarters: failing.map(q => q.quarter),
    demote,
    report,
  }
}

/** YYYY-Qn for a date. */
export function quarterOf(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`
}

/** True when the quarter is fully in the past. */
export function isCompleteQuarter(quarter: string, now = new Date()): boolean {
  return quarter < quarterOf(now.toISOString())
}
