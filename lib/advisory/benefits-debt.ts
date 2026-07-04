/**
 * Employer benefits + debt profile (upgrade item 2) — pure summaries that
 * feed the wealth checkup and the next-dollar waterfall. No guessing: null
 * in → needs_data out.
 */

export interface EmployerBenefits {
  matchAvailable: boolean | null
  matchFormula: string | null
  matchPercent: number | null
  matchCapPctOfPay: number | null
  vestingNotes: string | null
  onTrackForFullMatch: boolean | null
  updatedAt: string | null
}

export interface DebtAccount {
  id: string
  name: string
  debtType: string
  balanceUsd: number
  aprPct: number | null
  minimumPaymentUsd: number | null
  payoffPriority: number | null
}

export interface DebtSummary {
  totalBalanceUsd: number
  count: number
  /** Highest-APR debt with a positive balance, if any APR is known. */
  highestApr: { name: string; aprPct: number; balanceUsd: number } | null
  totalMinimumPaymentsUsd: number | null
  /** Debts missing APR — they cannot be ranked against investing. */
  missingAprCount: number
  /** Ordered payoff list: explicit priority first, then APR descending. */
  payoffOrder: DebtAccount[]
}

export function summarizeDebts(debts: DebtAccount[]): DebtSummary {
  const active = debts.filter(d => d.balanceUsd > 0)
  const withApr = active.filter(d => d.aprPct != null)
  const highest = withApr.length
    ? withApr.reduce((best, d) => (d.aprPct! > (best.aprPct ?? -1) ? d : best))
    : null
  const minimums = active.map(d => d.minimumPaymentUsd).filter((v): v is number => v != null)

  const payoffOrder = [...active].sort((a, b) => {
    if (a.payoffPriority != null || b.payoffPriority != null) {
      return (a.payoffPriority ?? Number.POSITIVE_INFINITY) - (b.payoffPriority ?? Number.POSITIVE_INFINITY)
    }
    return (b.aprPct ?? -1) - (a.aprPct ?? -1)
  })

  return {
    totalBalanceUsd: active.reduce((s, d) => s + d.balanceUsd, 0),
    count: active.length,
    highestApr: highest
      ? { name: highest.name, aprPct: highest.aprPct!, balanceUsd: highest.balanceUsd }
      : null,
    totalMinimumPaymentsUsd: minimums.length ? minimums.reduce((s, v) => s + v, 0) : null,
    missingAprCount: active.length - withApr.length,
    payoffOrder,
  }
}

/**
 * Employer match capture status. null inputs → 'unknown' (needs data);
 * available + not on track → 'unclaimed' (the waterfall's #2 priority);
 * available + on track → 'captured'.
 */
export type MatchStatus = 'unknown' | 'none' | 'unclaimed' | 'captured' | 'on_track_unknown'

export function matchCaptureStatus(b: EmployerBenefits): MatchStatus {
  if (b.matchAvailable == null) return 'unknown'
  if (!b.matchAvailable) return 'none'
  if (b.onTrackForFullMatch == null) return 'on_track_unknown'
  return b.onTrackForFullMatch ? 'captured' : 'unclaimed'
}
