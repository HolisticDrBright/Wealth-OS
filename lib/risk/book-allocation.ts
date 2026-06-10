/**
 * Book-level risk allocation — computes live exposure per strategy book from
 * open paper positions and enforces book notional caps + regime rotation.
 *
 * This layer only ever REDUCES size relative to what the existing controls
 * (per-position cap, Kelly haircuts, correlation caps, regime haircut)
 * produced. It can never increase a position or bypass an upstream block.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  bookFor, regimeBookMultiplier, BOOK_NOTIONAL_CAP, ALL_BOOKS,
  type StrategyBook,
} from '@/lib/strategies/strategy-books'

export interface BookExposure {
  book: StrategyBook
  openNotionalUsd: number
  /** Share of total open notional (0 when book is empty or book is everything). */
  share: number
  capShare: number
  utilization: number  // share / capShare
}

export interface BookGateResult {
  allowed: boolean
  /** Final multiplier to apply to the proposed notional (0–1]. */
  multiplier: number
  reason: string | null
  book: StrategyBook
}

/** Sum open notional per book from the user's open paper positions. */
export async function computeBookExposures(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ totalNotionalUsd: number; byBook: Record<StrategyBook, number> }> {
  const byBook = Object.fromEntries(ALL_BOOKS.map(b => [b, 0])) as Record<StrategyBook, number>

  const { data } = await supabase
    .from('paper_positions')
    .select('strategy_key, notional_usd')
    .eq('user_id', userId)
    .eq('status', 'open')

  let total = 0
  for (const row of data ?? []) {
    const notional = (row.notional_usd as number) ?? 0
    total += notional
    byBook[bookFor(row.strategy_key as string)] += notional
  }

  return { totalNotionalUsd: total, byBook }
}

export function summarizeBookExposures(
  totalNotionalUsd: number,
  byBook: Record<StrategyBook, number>,
): BookExposure[] {
  return ALL_BOOKS.map(book => {
    const open = byBook[book] ?? 0
    const share = totalNotionalUsd > 0 ? open / totalNotionalUsd : 0
    const capShare = BOOK_NOTIONAL_CAP[book]
    return { book, openNotionalUsd: open, share, capShare, utilization: capShare > 0 ? share / capShare : 0 }
  })
}

/**
 * Gate a proposed new position through the book layer.
 *
 * 1. Regime rotation multiplier (≤ 1.0) shrinks disfavoured books.
 * 2. Book notional cap: if (bookOpen + proposed) / (total + proposed) would
 *    exceed the cap, scale the proposal down to fit; block when the room left
 *    is negligible (< 10% of the proposal).
 */
export function gateThroughBook(opts: {
  strategyKey: string
  proposedNotionalUsd: number
  regime: string
  totalNotionalUsd: number
  bookNotionalUsd: number
}): BookGateResult {
  const { strategyKey, proposedNotionalUsd, regime, totalNotionalUsd, bookNotionalUsd } = opts
  const book = bookFor(strategyKey)

  // Regime rotation first
  const regimeMult = regimeBookMultiplier(regime, book)
  if (regimeMult <= 0) {
    return {
      allowed: false, multiplier: 0, book,
      reason: `${book} book is closed in ${regime} regime.`,
    }
  }

  const proposed = proposedNotionalUsd * regimeMult

  // Book cap: solve for the largest x ≤ proposed with
  // (bookOpen + x) / (total + x) ≤ cap  →  x ≤ (cap·total − bookOpen) / (1 − cap)
  const cap = BOOK_NOTIONAL_CAP[book]
  let roomUsd = Infinity
  if (cap < 1) {
    roomUsd = (cap * totalNotionalUsd - bookNotionalUsd) / (1 - cap)
  }

  // Empty portfolio: the first position is always 100% of one book — allow a
  // floor so the book layer can't deadlock a fresh account.
  if (totalNotionalUsd <= 0) {
    return { allowed: true, multiplier: regimeMult, book, reason: regimeMult < 1 ? `${book} book reduced ${Math.round((1 - regimeMult) * 100)}% in ${regime} regime.` : null }
  }

  if (roomUsd <= proposed * 0.1) {
    return {
      allowed: false, multiplier: 0, book,
      reason: `${book} book at cap (${Math.round(cap * 100)}% of open notional) — no meaningful room.`,
    }
  }

  if (roomUsd < proposed) {
    const fitMult = (roomUsd / proposedNotionalUsd)
    return {
      allowed: true,
      multiplier: Math.min(regimeMult, fitMult),
      book,
      reason: `${book} book near cap — size reduced to fit ${Math.round(cap * 100)}% budget.`,
    }
  }

  return {
    allowed: true,
    multiplier: regimeMult,
    book,
    reason: regimeMult < 1 ? `${book} book reduced ${Math.round((1 - regimeMult) * 100)}% in ${regime} regime.` : null,
  }
}
