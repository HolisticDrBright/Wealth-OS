/**
 * Copier-adjusted trader results + practice-run guardrails (Phase 4.4) — PURE.
 *
 * "Their result" is the trader's headline return. "What a copier got" is:
 *  - ACTUAL: the mean P&L% of this user's real copied positions for that
 *    trader, when there are enough of them (n >= MIN_ACTUAL_COPIES), else
 *  - ESTIMATE: headline minus a copy-delay haircut and modeled round-trip
 *    costs scaled by how often the trader trades. Labeled as an estimate.
 *
 * Auto-copy is locked behind a paper-copy practice run of
 * PAPER_COPY_PERIOD_DAYS days. Simple mode never ranks by raw return: the
 * sort key is the copier-adjusted result scaled down by the swing class.
 */

import { roundTripCostBps } from '@/lib/costs/transaction-costs'

/** Days of paper copying required before auto-copy can be enabled. */
export const PAPER_COPY_PERIOD_DAYS = 30

/** Fraction of a trader's edge assumed lost to copy delay (estimate, labeled). */
export const COPY_DELAY_HAIRCUT_FRACTION = 0.35

/** Minimum real copied positions before we show actuals instead of estimates. */
export const MIN_ACTUAL_COPIES = 5

export interface CopierResult {
  headlinePct: number
  copierPct: number
  /** true = modeled estimate; false = from the user's real copied positions. */
  isEstimate: boolean
  explanation: string
}

const TRADING_DAYS_PER_YEAR = 250

/** Modeled copier result: delay haircut + round-trip costs × yearly turnover. */
export function estimatedCopierResultPct(args: {
  headlineReturnPct: number
  assetClass: string
  /** Trader's listed lifetime trade count (turnover proxy). */
  tradeCount: number | null
}): number {
  const { headlineReturnPct, assetClass, tradeCount } = args
  const afterDelay = headlineReturnPct * (1 - COPY_DELAY_HAIRCUT_FRACTION)
  // Cost drag: each copied trade pays the venue round trip. Turnover proxy:
  // listed trade count capped at one trade per trading day for a year.
  const tradesPerYear = Math.min(TRADING_DAYS_PER_YEAR, Math.max(1, tradeCount ?? 12))
  const costDragPct = (roundTripCostBps(assetClass) / 10_000) * tradesPerYear * 100
  return Math.round((afterDelay - Math.min(costDragPct, Math.abs(afterDelay))) * 10) / 10
}

export function copierResultFor(args: {
  headlineReturnPct: number
  assetClass: string
  tradeCount: number | null
  /** P&L% values of this user's REAL copied positions for the trader. */
  actualCopyPnlPcts: number[]
}): CopierResult {
  if (args.actualCopyPnlPcts.length >= MIN_ACTUAL_COPIES) {
    const mean = args.actualCopyPnlPcts.reduce((s, x) => s + x, 0) / args.actualCopyPnlPcts.length
    return {
      headlinePct: args.headlineReturnPct,
      copierPct: Math.round(mean * 10) / 10,
      isEstimate: false,
      explanation: `From ${args.actualCopyPnlPcts.length} of your real copied trades — trades arrive late and cost money to place.`,
    }
  }
  return {
    headlinePct: args.headlineReturnPct,
    copierPct: estimatedCopierResultPct(args),
    isEstimate: true,
    explanation: 'Estimate: copiers get less because trades arrive late and cost money to place.',
  }
}

// ─── Swings + ranking ────────────────────────────────────────────────────────

export type SwingLabel = 'lower' | 'bigger'

/** Plain-language volatility class by market (no Sharpe, no sigma). */
export function swingLabelOf(assetClass: string): SwingLabel {
  switch (assetClass) {
    case 'crypto':
    case 'polymarket':
      return 'bigger'
    default:
      return 'lower'
  }
}

/**
 * Simple-mode sort key: copier-adjusted result, halved for bigger-swing
 * markets. NEVER the raw headline return.
 */
export function riskAdjustedSortKey(copierPct: number, assetClass: string): number {
  return swingLabelOf(assetClass) === 'bigger' ? copierPct / 2 : copierPct
}

// ─── Practice run ────────────────────────────────────────────────────────────

export interface PracticeRun {
  dayN: number
  totalDays: number
  complete: boolean
}

export function practiceRunProgress(followedAtIso: string | null, now = new Date()): PracticeRun | null {
  if (!followedAtIso) return null
  const started = new Date(followedAtIso).getTime()
  if (!Number.isFinite(started)) return null
  const dayN = Math.max(1, Math.floor((now.getTime() - started) / 86_400_000) + 1)
  return {
    dayN: Math.min(dayN, PAPER_COPY_PERIOD_DAYS),
    totalDays: PAPER_COPY_PERIOD_DAYS,
    complete: dayN > PAPER_COPY_PERIOD_DAYS,
  }
}
