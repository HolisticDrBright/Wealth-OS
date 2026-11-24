'use server'

/**
 * Book exposure summary for the Strategy Health Board and the pro-mode Risk
 * Room — how much of the open paper strategy book sits in each multi-strat
 * book vs. its cap, by DOLLARS and by RISK UNITS (Phase 4), plus the current
 * regime's rotation stance and the Explore risk budget.
 */

import { createClient } from '@/lib/supabase/server'
import { computeBookExposures, summarizeBookExposures, type BookExposure } from '@/lib/risk/book-allocation'
import { BOOK_META, REGIME_BOOK_MULTIPLIER, type StrategyBook, type RegimeName } from '@/lib/strategies/strategy-books'
import { detectRegime } from '@/lib/regime/cross-asset-regime'
import { getExploreUsage } from '@/lib/explore/cap'
import { exploreRiskBudget } from '@/lib/risk/risk-units'
import { MAX_POSITION_RISK_SHARE, EXPLORE_RISK_REFERENCE_VOL } from '@/lib/config/product-defaults'

export interface BookExposureView extends BookExposure {
  label: string
  blurb: string
  /** Current regime's rotation multiplier for this book (≤ 1). */
  regimeMultiplier: number
}

export interface BookAllocationView {
  regime: string
  totalNotionalUsd: number
  /** Open risk units (Σ notional × annualized vol; a binary's stake). */
  totalRiskUnits: number
  /** Explore cap dollars × EXPLORE_RISK_REFERENCE_VOL (null if unavailable). */
  exploreRiskBudget: number | null
  referenceVol: number
  /** Most risk units one position may use. */
  positionRiskCeiling: number | null
  books: BookExposureView[]
}

export async function getBookAllocation(): Promise<BookAllocationView | null> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const [regime, exposures, usage] = await Promise.all([
      detectRegime().then(r => r.regime as RegimeName).catch(() => 'NEUTRAL' as RegimeName),
      computeBookExposures(supabase, user.id),
      getExploreUsage(supabase, user.id).catch(() => null),
    ])

    const rows = summarizeBookExposures(
      exposures.totalNotionalUsd, exposures.byBook, exposures.totalRiskUnits, exposures.riskByBook)
    const budget = usage ? exploreRiskBudget(usage.capUsd) : null
    const multipliers = REGIME_BOOK_MULTIPLIER[regime] ?? REGIME_BOOK_MULTIPLIER.NEUTRAL

    return {
      regime,
      totalNotionalUsd: exposures.totalNotionalUsd,
      totalRiskUnits: exposures.totalRiskUnits,
      exploreRiskBudget: budget,
      referenceVol: EXPLORE_RISK_REFERENCE_VOL,
      positionRiskCeiling: budget == null ? null : budget * MAX_POSITION_RISK_SHARE,
      books: rows.map(r => ({
        ...r,
        label: BOOK_META[r.book as StrategyBook].label,
        blurb: BOOK_META[r.book as StrategyBook].blurb,
        regimeMultiplier: multipliers[r.book as StrategyBook],
      })),
    }
  } catch {
    return null
  }
}
