'use server'

/**
 * Book exposure summary for the Strategy Health Board — how much of the open
 * paper portfolio sits in each multi-strat book vs. its notional cap, plus the
 * current regime's rotation stance.
 */

import { createClient } from '@/lib/supabase/server'
import { computeBookExposures, summarizeBookExposures, type BookExposure } from '@/lib/risk/book-allocation'
import { BOOK_META, REGIME_BOOK_MULTIPLIER, type StrategyBook, type RegimeName } from '@/lib/strategies/strategy-books'
import { detectRegime } from '@/lib/regime/cross-asset-regime'

export interface BookExposureView extends BookExposure {
  label: string
  blurb: string
  /** Current regime's rotation multiplier for this book (≤ 1). */
  regimeMultiplier: number
}

export interface BookAllocationView {
  regime: string
  totalNotionalUsd: number
  books: BookExposureView[]
}

export async function getBookAllocation(): Promise<BookAllocationView | null> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const [regime, exposures] = await Promise.all([
      detectRegime().then(r => r.regime as RegimeName).catch(() => 'NEUTRAL' as RegimeName),
      computeBookExposures(supabase, user.id),
    ])

    const rows = summarizeBookExposures(exposures.totalNotionalUsd, exposures.byBook)
    const multipliers = REGIME_BOOK_MULTIPLIER[regime] ?? REGIME_BOOK_MULTIPLIER.NEUTRAL

    return {
      regime,
      totalNotionalUsd: exposures.totalNotionalUsd,
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
