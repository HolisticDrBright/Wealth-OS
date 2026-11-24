/**
 * Book-level risk allocation — computes live exposure per strategy book from
 * open paper positions and enforces book caps + regime rotation.
 *
 * Each book's cap applies twice (Phase 4): to its share of open NOTIONAL and
 * to its share of open RISK UNITS (notional × annualized volatility; a binary
 * market's stake). The gate takes the smaller allowed size, so a book of
 * volatile positions fills its budget sooner than its dollars alone suggest.
 *
 * This layer only ever REDUCES size relative to what the existing controls
 * (per-position cap, Kelly haircuts, correlation caps, regime haircut)
 * produced. It can never increase a position or bypass an upstream block.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  booksFor, regimeBookMultiplier, BOOK_NOTIONAL_CAP, ALL_BOOKS,
  type StrategyBook,
} from '@/lib/strategies/strategy-books'
import { LADDER_KEYS_FILTER } from '@/lib/allocation/sleeves'
import { getAnnualVol, riskUnits, type VolEstimate } from '@/lib/risk/risk-units'

export interface BookExposure {
  book: StrategyBook
  openNotionalUsd: number
  /** Share of total open notional (0 when book is empty or book is everything). */
  share: number
  /** Open risk units (notional × annualized vol) in this book. */
  riskUnits: number
  /** Share of total open risk units. */
  riskShare: number
  capShare: number
  /** The binding utilization: max(dollar share, risk share) / capShare. */
  utilization: number
}

export interface BookState {
  totalNotionalUsd: number
  byBook: Record<StrategyBook, number>
  totalRiskUnits: number
  riskByBook: Record<StrategyBook, number>
}

export interface BookGateResult {
  allowed: boolean
  /** Final multiplier to apply to the proposed notional (0–1]. */
  multiplier: number
  reason: string | null
  book: StrategyBook
}

type VolFor = (symbol: string, assetClass: string) => Promise<VolEstimate>

/**
 * Sum open notional AND risk units per book from the user's open paper
 * strategy positions. `volFor` is injectable for tests.
 */
export async function computeBookExposures(
  supabase: SupabaseClient,
  userId: string,
  volFor: VolFor = getAnnualVol,
): Promise<BookState> {
  const zero = () => Object.fromEntries(ALL_BOOKS.map(b => [b, 0])) as Record<StrategyBook, number>
  const byBook = zero()
  const riskByBook = zero()

  const { data } = await supabase
    .from('paper_positions')
    .select('strategy_key, symbol, asset_class, notional_usd').not('strategy_key', 'in', LADDER_KEYS_FILTER)
    .eq('user_id', userId)
    .eq('status', 'open')

  const rows = (data ?? []) as Array<{ strategy_key: string; symbol: string | null; asset_class: string | null; notional_usd: number | null }>
  const vols = new Map<string, number>()
  await Promise.all([...new Set(rows.map(r => `${r.asset_class ?? ''}|${r.symbol ?? ''}`))].map(async k => {
    const [cls, sym] = k.split('|')
    vols.set(k, (await volFor(sym, cls).catch(() => null))?.vol ?? 1)   // unknown → as risky as a binary
  }))

  let total = 0
  let totalRisk = 0
  for (const row of rows) {
    const notional = Math.abs(row.notional_usd ?? 0)
    const ru = riskUnits(notional, vols.get(`${row.asset_class ?? ''}|${row.symbol ?? ''}`) ?? 1)
    // A moved strategy counts against its old book too (Phase 5) — added to
    // each book it belongs to, but only once to the totals.
    total += notional
    totalRisk += ru
    for (const book of booksFor(row.strategy_key)) {
      byBook[book] += notional
      riskByBook[book] += ru
    }
  }

  return { totalNotionalUsd: total, byBook, totalRiskUnits: totalRisk, riskByBook }
}

export function summarizeBookExposures(
  totalNotionalUsd: number,
  byBook: Record<StrategyBook, number>,
  totalRiskUnits = 0,
  riskByBook: Partial<Record<StrategyBook, number>> = {},
): BookExposure[] {
  return ALL_BOOKS.map(book => {
    const open = byBook[book] ?? 0
    const share = totalNotionalUsd > 0 ? open / totalNotionalUsd : 0
    const ru = riskByBook[book] ?? 0
    const riskShare = totalRiskUnits > 0 ? ru / totalRiskUnits : 0
    const capShare = BOOK_NOTIONAL_CAP[book]
    return {
      book, openNotionalUsd: open, share, riskUnits: ru, riskShare, capShare,
      utilization: capShare > 0 ? Math.max(share, riskShare) / capShare : 0,
    }
  })
}

/** Largest x ≤ ∞ with (open + x·w) / (total + x·w) ≤ cap, in units of x. */
function roomFor(cap: number, total: number, open: number, weight: number): number {
  if (cap >= 1 || weight <= 0) return Infinity
  return (cap * total - open) / ((1 - cap) * weight)
}

/**
 * Gate a proposed new position through the book layer.
 *
 * 1. Regime rotation multiplier (≤ 1.0) shrinks disfavoured books.
 * 2. Book notional cap: if (bookOpen + proposed) / (total + proposed) would
 *    exceed the cap, scale the proposal down to fit; block when the room left
 *    is negligible (< 10% of the proposal).
 */
interface GateOpts {
  strategyKey: string
  proposedNotionalUsd: number
  regime: string
  totalNotionalUsd: number
  /** Open notional in the strategy's LABEL book. */
  bookNotionalUsd: number
  /**
   * Phase 4 risk-unit gate (ADDITIONAL). Omitted → dollar gate only.
   * proposedVol: the new position's annualized vol (1 for a binary stake).
   */
  proposedVol?: number
  totalRiskUnits?: number
  bookRiskUnits?: number
  /**
   * Phase 5: exposure of the OTHER books a moved strategy also counts
   * against (ALSO_COUNTS_AGAINST). Missing → treated as empty.
   */
  otherBooks?: Partial<Record<StrategyBook, { notionalUsd: number; riskUnits: number }>>
}

/**
 * Gate a proposed position through EVERY book its strategy counts against
 * (Phase 5: a moved strategy counts against its old book too). It must fit
 * each book's regime multiplier and cap; the smallest allowed size wins.
 */
export function gateThroughBook(opts: GateOpts): BookGateResult {
  const books = booksFor(opts.strategyKey)
  const primary = books[0]
  const results = books.map(b => b === primary
    ? gateOneBook(b, opts)
    : gateOneBook(b, {
        ...opts,
        bookNotionalUsd: opts.otherBooks?.[b]?.notionalUsd ?? 0,
        bookRiskUnits: opts.bookRiskUnits == null ? undefined : (opts.otherBooks?.[b]?.riskUnits ?? 0),
      }))
  const blocked = results.find(r => !r.allowed)
  if (blocked) {
    return {
      ...blocked, book: primary,
      reason: blocked.book !== primary ? `${blocked.reason} (${opts.strategyKey} still counts against its old ${blocked.book} book)` : blocked.reason,
    }
  }
  const binding = results.reduce((a, r) => (r.multiplier < a.multiplier ? r : a))
  return { allowed: true, multiplier: binding.multiplier, book: primary, reason: binding.reason }
}

function gateOneBook(book: StrategyBook, opts: GateOpts): BookGateResult {
  const { proposedNotionalUsd, regime, totalNotionalUsd, bookNotionalUsd } = opts

  // Regime rotation first
  const regimeMult = regimeBookMultiplier(regime, book)
  if (regimeMult <= 0) {
    return {
      allowed: false, multiplier: 0, book,
      reason: `${book} book is closed in ${regime} regime.`,
    }
  }

  const proposed = proposedNotionalUsd * regimeMult

  // Book cap on DOLLARS: the largest x ≤ proposed with
  // (bookOpen + x) / (total + x) ≤ cap  →  x ≤ (cap·total − bookOpen) / (1 − cap)
  const cap = BOOK_NOTIONAL_CAP[book]
  const dollarRoomUsd = roomFor(cap, totalNotionalUsd, bookNotionalUsd, 1)

  // Book cap on RISK UNITS (Phase 4): (bookRisk + x·v) / (totalRisk + x·v) ≤ cap.
  const riskActive = opts.proposedVol != null && opts.totalRiskUnits != null && opts.bookRiskUnits != null &&
    (opts.totalRiskUnits ?? 0) > 0
  const riskRoomUsd = riskActive
    ? roomFor(cap, opts.totalRiskUnits!, opts.bookRiskUnits!, Math.max(opts.proposedVol!, 1e-9))
    : Infinity
  const roomUsd = Math.min(dollarRoomUsd, riskRoomUsd)
  const riskBinds = riskRoomUsd < dollarRoomUsd

  // Empty portfolio: the first position is always 100% of one book — allow a
  // floor so the book layer can't deadlock a fresh account.
  if (totalNotionalUsd <= 0) {
    return { allowed: true, multiplier: regimeMult, book, reason: regimeMult < 1 ? `${book} book reduced ${Math.round((1 - regimeMult) * 100)}% in ${regime} regime.` : null }
  }

  const what = riskBinds ? 'of open risk' : 'of open notional'
  if (roomUsd <= proposed * 0.1) {
    return {
      allowed: false, multiplier: 0, book,
      reason: `${book} book at cap (${Math.round(cap * 100)}% ${what}) — no meaningful room.`,
    }
  }

  if (roomUsd < proposed) {
    const fitMult = (roomUsd / proposedNotionalUsd)
    return {
      allowed: true,
      multiplier: Math.min(regimeMult, fitMult),
      book,
      reason: `${book} book near cap — size reduced to fit ${Math.round(cap * 100)}% ${riskBinds ? 'risk ' : ''}budget.`,
    }
  }

  return {
    allowed: true,
    multiplier: regimeMult,
    book,
    reason: regimeMult < 1 ? `${book} book reduced ${Math.round((1 - regimeMult) * 100)}% in ${regime} regime.` : null,
  }
}
