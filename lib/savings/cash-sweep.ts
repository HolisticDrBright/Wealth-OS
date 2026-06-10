/**
 * Cash sweep / idle cash detector.
 *
 * Finds cash and cash-equivalent assets and computes how much annual yield
 * is being left on the table versus a high-yield benchmark (default: the
 * ~3-month T-bill / top HYSA rate). Opportunities are sorted by dollar
 * impact so the biggest sweep wins surface first.
 */

import type { Asset } from '@/lib/types'

/** Approximate 3-month T-bill / top HYSA yield (percent). Updated periodically. */
export const BENCHMARK_CASH_YIELD_PCT = 4.2

/** Minimum annual gap (USD) worth surfacing to the user. */
export const IDLE_CASH_MIN_GAP_USD = 50

export interface IdleCashOptions {
  /** Benchmark yield in percent. Default BENCHMARK_CASH_YIELD_PCT (4.2). */
  benchmarkYieldPct?: number
  /** Assumed yield (percent) for cash with no high-yield signal. Default 0.05 (typical checking). */
  assumedIdleYieldPct?: number
}

export interface IdleCashOpportunity {
  assetId: string
  name: string
  balance: number
  /** Estimated current yield (percent). */
  currentYieldPct: number
  benchmarkYieldPct: number
  /** Dollars per year left on the table vs the benchmark. */
  annualYieldGapUsd: number
}

export interface IdleCashSummary {
  opportunities: IdleCashOpportunity[]
  totalIdleCash: number
  totalAnnualGapUsd: number
  benchmarkYieldPct: number
}

/** Name/notes keywords suggesting the cash is already earning a competitive yield. */
const HIGH_YIELD_SIGNALS = [
  'hysa',
  'high yield',
  'high-yield',
  'money market',
  'mmf',
  't-bill',
  'tbill',
  'treasury',
  'sgov',
  'bil ',
  'cd ',
  'certificate of deposit',
]

function looksHighYield(asset: Asset): boolean {
  const haystack = `${asset.name} ${asset.symbol ?? ''} ${asset.notes ?? ''}`.toLowerCase()
  return HIGH_YIELD_SIGNALS.some(sig => haystack.includes(sig))
}

export function detectIdleCash(
  assets: Asset[],
  options: IdleCashOptions = {}
): IdleCashSummary {
  const benchmarkYieldPct = options.benchmarkYieldPct ?? BENCHMARK_CASH_YIELD_PCT
  const assumedIdleYieldPct = options.assumedIdleYieldPct ?? 0.05

  const cashAssets = assets.filter(
    a => a.category === 'cash' && (a.current_value ?? 0) > 0
  )

  const opportunities: IdleCashOpportunity[] = cashAssets
    .map(asset => {
      // Heuristic: assume cash already labeled high-yield earns the benchmark
      // (no gap); otherwise assume a near-zero checking/savings rate.
      const currentYieldPct = looksHighYield(asset)
        ? benchmarkYieldPct
        : assumedIdleYieldPct
      const gapPct = Math.max(0, benchmarkYieldPct - currentYieldPct)
      return {
        assetId: asset.id,
        name: asset.name,
        balance: asset.current_value,
        currentYieldPct,
        benchmarkYieldPct,
        annualYieldGapUsd: Math.round(asset.current_value * (gapPct / 100) * 100) / 100,
      }
    })
    .filter(o => o.annualYieldGapUsd > 0)
    .sort((a, b) => b.annualYieldGapUsd - a.annualYieldGapUsd)

  return {
    opportunities,
    totalIdleCash: opportunities.reduce((s, o) => s + o.balance, 0),
    totalAnnualGapUsd:
      Math.round(opportunities.reduce((s, o) => s + o.annualYieldGapUsd, 0) * 100) / 100,
    benchmarkYieldPct,
  }
}
