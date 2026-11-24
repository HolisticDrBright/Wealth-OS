/**
 * "In a bad year this could fall about $X" from the ACTUAL tier mix
 * (Phase 3) — PURE. Before Phase 3 every dollar was assumed to move like the
 * S&P 500. Now each tier moves like what it holds:
 *
 *   Safety (cash-like fund)      0 — no market drop
 *   Core stocks                  the S&P 500 series
 *   Core bonds                   the bond fund's own series (stock series if
 *                                that series can't be fetched — never understates)
 *   Explore in use + anything    the S&P 500 series (conservative: strategy
 *   not yet placed in a tier     money is at least as risky as stocks)
 *
 * The series are blended month by month (weights = dollars per tier), so the
 * stock/bond correlation in the real history is kept; good/typical/bad years
 * then come from the same rolling-year percentiles as everywhere else.
 */

import type { Ladder } from '@/lib/allocation/ladder'
import { yearRangeUsd, type YearRangeUsd } from '@/lib/planning/goal-projection'

export interface TierMix {
  cashUsd: number
  stocksUsd: number
  bondsUsd: number
  /** Explore in use + money not yet placed in Safety or Core. */
  otherUsd: number
}

export function tierMixOf(ladder: Ladder): TierMix {
  const total = Math.max(0, ladder.investableUsd)
  const cashUsd = Math.min(total, Math.max(0, ladder.tier1.heldUsd))
  let stocksUsd = 0
  let bondsUsd = 0
  for (const f of ladder.core.funds) {
    if (f.assetClass === 'stock') stocksUsd += f.heldUsd
    else if (f.assetClass === 'bond') bondsUsd += f.heldUsd
  }
  const otherUsd = Math.max(0, total - cashUsd - stocksUsd - bondsUsd)
  return { cashUsd, stocksUsd, bondsUsd, otherUsd }
}

/**
 * The mix for a displayed total that can be larger than the ladder's money
 * (real estate, strategy P&L): the difference counts as stock-like.
 */
export function tierMixForTotal(ladder: Ladder, totalUsd: number): TierMix {
  const mix = tierMixOf(ladder)
  mix.otherUsd += Math.max(0, totalUsd - ladder.investableUsd)
  return mix
}

/** Month-by-month blend of the stock and bond series, aligned on the most recent months. */
export function blendedMonthlyReturns(mix: TierMix, stockReturns: number[], bondReturns: number[]): number[] {
  const total = mix.cashUsd + mix.stocksUsd + mix.bondsUsd + mix.otherUsd
  if (!(total > 0) || stockReturns.length === 0) return []
  const stockW = (mix.stocksUsd + mix.otherUsd) / total
  const bondW = mix.bondsUsd / total
  // No bond series → bonds move like stocks (overstates, never understates).
  const useBonds = bondReturns.length > 0
  const n = useBonds ? Math.min(stockReturns.length, bondReturns.length) : stockReturns.length
  const s = stockReturns.slice(-n)
  const b = useBonds ? bondReturns.slice(-n) : s
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(stockW * s[i] + bondW * b[i])
  return out
}

/** Good / typical / bad year in dollars for this mix (null = not enough history). */
export function yearRangeForMix(mix: TierMix, stockReturns: number[], bondReturns: number[]): YearRangeUsd | null {
  const total = mix.cashUsd + mix.stocksUsd + mix.bondsUsd + mix.otherUsd
  if (!(total > 0)) return null
  return yearRangeUsd(total, blendedMonthlyReturns(mix, stockReturns, bondReturns))
}

/** The bad-year loss as a fraction of the mix (≤ 0), for scaling a goal's slice. */
export function badYearFraction(mix: TierMix, stockReturns: number[], bondReturns: number[]): number | null {
  const total = mix.cashUsd + mix.stocksUsd + mix.bondsUsd + mix.otherUsd
  const range = yearRangeForMix(mix, stockReturns, bondReturns)
  return range && total > 0 ? range.badYearUsd / total : null
}

/**
 * The mix after a planned set of fund trades (for the approval screen's
 * "bad year before / after"). Buys draw on unplaced money first, then cash;
 * sells return money to unplaced (a rebalance's buys then use it).
 */
export function mixAfterTrades(
  mix: TierMix,
  trades: Array<{ sleeve: 'core' | 'safety'; symbol: string; side: 'buy' | 'sell'; usd: number }>,
  ladder: Ladder,
): TierMix {
  const out = { ...mix }
  const classOf = (symbol: string) => ladder.core.funds.find(f => f.symbol === symbol)?.assetClass ?? 'stock'
  const draw = (usd: number) => {
    const fromOther = Math.min(out.otherUsd, usd)
    out.otherUsd -= fromOther
    out.cashUsd = Math.max(0, out.cashUsd - (usd - fromOther))
  }
  for (const t of [...trades].sort((a, b) => (a.side === b.side ? 0 : a.side === 'sell' ? -1 : 1))) {
    if (t.sleeve === 'safety') {
      if (t.side === 'buy') { draw(t.usd); out.cashUsd += t.usd }
      else { out.cashUsd = Math.max(0, out.cashUsd - t.usd); out.otherUsd += t.usd }
      continue
    }
    const cls = classOf(t.symbol)
    if (t.side === 'buy') {
      draw(t.usd)
      if (cls === 'bond') out.bondsUsd += t.usd
      else out.stocksUsd += t.usd
    } else {
      if (cls === 'bond') out.bondsUsd = Math.max(0, out.bondsUsd - t.usd)
      else out.stocksUsd = Math.max(0, out.stocksUsd - t.usd)
      out.otherUsd += t.usd
    }
  }
  return out
}
