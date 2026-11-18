/**
 * Goal projection + dollar year-range (Phase 3.2b / 3.4) — PURE helpers.
 *
 * Everything derives from the SAME historical monthly return series the
 * planning Monte Carlo block-bootstraps from (no new risk model):
 *  - expected goal date: deterministic compounding at the series' median
 *    monthly return plus the user's monthly contribution,
 *  - good/typical/bad year in dollars: p90/p50/p10 of rolling 12-month
 *    compounded windows, scaled by the current portfolio value.
 */

const MAX_PROJECTION_MONTHS = 1200   // 100 years — beyond this, say "not on this path"
const MONTHS_PER_YEAR = 12

export function medianOf(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function percentileOf(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))
  return sorted[idx]
}

/**
 * Months until value reaches target, compounding monthly at `monthlyReturn`
 * with `monthlyContributionUsd` added each month. null = not within 100 years
 * (or impossible: no growth and no contribution).
 */
export function projectGoalMonths(args: {
  currentUsd: number
  monthlyContributionUsd: number
  targetUsd: number
  monthlyReturn: number
}): number | null {
  const { currentUsd, monthlyContributionUsd, targetUsd, monthlyReturn } = args
  if (!(targetUsd > 0)) return null
  if (currentUsd >= targetUsd) return 0
  let v = Math.max(0, currentUsd)
  for (let m = 1; m <= MAX_PROJECTION_MONTHS; m++) {
    v = v * (1 + monthlyReturn) + monthlyContributionUsd
    if (v >= targetUsd) return m
  }
  return null
}

export function addMonths(fromIso: string, months: number): string {
  const d = new Date(fromIso)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}

export type GoalStatus = 'on_track' | 'behind' | 'no_target_date' | 'unknown'

export function goalStatusOf(expectedDate: string | null, targetDate: string | null): GoalStatus {
  if (!expectedDate) return 'unknown'
  if (!targetDate) return 'no_target_date'
  return expectedDate <= targetDate ? 'on_track' : 'behind'
}

/** Compounded return of each rolling 12-month window in the series. */
export function rollingYearReturns(monthlyReturns: number[]): number[] {
  const out: number[] = []
  for (let i = 0; i + MONTHS_PER_YEAR <= monthlyReturns.length; i++) {
    let r = 1
    for (let j = i; j < i + MONTHS_PER_YEAR; j++) r *= 1 + monthlyReturns[j]
    out.push(r - 1)
  }
  return out
}

export interface YearRangeUsd {
  goodYearUsd: number     // p90 — positive in any sane series
  typicalYearUsd: number  // p50
  badYearUsd: number      // p10 — usually negative (a DROP)
}

/**
 * Good/typical/bad year in dollars for a portfolio of `totalUsd`.
 * Returns null when the series is too short to say anything honest (<36m).
 */
export function yearRangeUsd(totalUsd: number, monthlyReturns: number[]): YearRangeUsd | null {
  if (!(totalUsd > 0)) return null
  const years = rollingYearReturns(monthlyReturns)
  if (years.length < 24) return null
  const sorted = [...years].sort((a, b) => a - b)
  return {
    goodYearUsd: Math.round(percentileOf(sorted, 0.9) * totalUsd),
    typicalYearUsd: Math.round(percentileOf(sorted, 0.5) * totalUsd),
    badYearUsd: Math.round(percentileOf(sorted, 0.1) * totalUsd),
  }
}

/**
 * How many months a bad year would push the goal back: re-run the projection
 * from (value + badYearUsd) and take the difference.
 */
export function badYearSetbackMonths(args: {
  currentUsd: number
  monthlyContributionUsd: number
  targetUsd: number
  monthlyReturn: number
  badYearUsd: number
}): number | null {
  const base = projectGoalMonths(args)
  if (base == null) return null
  const after = projectGoalMonths({ ...args, currentUsd: Math.max(0, args.currentUsd + args.badYearUsd) })
  if (after == null) return null
  return Math.max(0, after - base)
}
