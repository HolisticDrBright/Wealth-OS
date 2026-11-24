/**
 * Explore vs Core (roadmap #3) — PURE. Does the strategy slice earn its keep?
 *
 * For every closed Explore (strategy) paper trade we ask: what would the SAME
 * dollars have earned sitting in your Core funds over the SAME days?
 *
 *   strategy, after costs = realized P&L − round-trip venue cost on the notional
 *                           (the same cost model as the promotion gate)
 *   Core, same dollars    = notional × the Core mix's return from the open
 *                           date to the close date (daily closes; holding Core
 *                           costs nothing extra — the money was already there)
 *   excess                = strategy − Core
 *
 * Per strategy and in total. If the total trails Core over a meaningful
 * stretch (EXPLORE_REVIEW_MIN_DAYS and EXPLORE_REVIEW_MIN_TRADES), the
 * manager's call is to SHRINK Explore — a proposal that only ever lowers the
 * limit and always needs the person's approval.
 */

import { roundTripCostBps } from '@/lib/costs/transaction-costs'
import {
  EXPLORE_REVIEW_MIN_DAYS, EXPLORE_REVIEW_MIN_TRADES, EXPLORE_SHRINK_FACTOR, EXPLORE_MIN_CAP_FRACTION,
} from '@/lib/config/product-defaults'

export interface DailyPoint { date: string; close: number }
export type DailySeries = Record<string, DailyPoint[]>
export interface FundWeight { symbol: string; weight: number }

export interface ExploreTrade {
  strategy_key: string
  asset_class: string
  notional_usd: number | null
  realized_pnl_usd: number | null
  opened_at: string | null
  closed_at: string | null
}

/** Close on or before `date` (series sorted ascending by date). */
function closeOnOrBefore(series: DailyPoint[], date: string): number | null {
  let lo = 0, hi = series.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (series[mid].date <= date) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans >= 0 ? series[ans].close : null
}

/** Weighted Core return between two dates; null when any fund lacks prices for the window. */
export function coreReturnBetween(series: DailySeries, weights: FundWeight[], fromIso: string, toIso: string): number | null {
  const from = fromIso.slice(0, 10)
  const to = toIso.slice(0, 10)
  const total = weights.reduce((s, w) => s + Math.max(0, w.weight), 0)
  if (!(total > 0)) return null
  let r = 0
  for (const w of weights) {
    if (!(w.weight > 0)) continue
    const s = series[w.symbol]
    if (!s?.length || s[0].date > from) return null       // no history that far back
    const a = closeOnOrBefore(s, from)
    const b = closeOnOrBefore(s, to)
    if (a == null || b == null || !(a > 0)) return null
    r += (w.weight / total) * (b / a - 1)
  }
  return r
}

export interface VsCoreLine {
  trades: number
  notionalUsd: number
  /** Strategy P&L after the round-trip cost model. */
  netUsd: number
  /** What the same dollars earned in Core over the same days. */
  coreUsd: number
  /** net − core. Negative = Explore lost to simply holding Core. */
  excessUsd: number
  /** excess as a share of the notional traded. */
  excessPct: number | null
  /** Trades we couldn't price against Core (missing history). */
  unpriced: number
}

export interface ExploreVsCore {
  perStrategy: Array<VsCoreLine & { strategyKey: string }>
  total: VsCoreLine
  /** Open date of the oldest compared trade. */
  firstTradeAt: string | null
  /** Days from the oldest compared trade to now. */
  daysCovered: number
}

const emptyLine = (): VsCoreLine => ({ trades: 0, notionalUsd: 0, netUsd: 0, coreUsd: 0, excessUsd: 0, excessPct: null, unpriced: 0 })

export function exploreVsCore(trades: ExploreTrade[], series: DailySeries, weights: FundWeight[], now: Date = new Date()): ExploreVsCore {
  const by = new Map<string, VsCoreLine>()
  const total = emptyLine()
  let first: string | null = null
  for (const t of trades) {
    if (!t.opened_at || !t.closed_at) continue
    const line = by.get(t.strategy_key) ?? emptyLine()
    by.set(t.strategy_key, line)
    const notional = Math.abs(Number(t.notional_usd ?? 0))
    const core = coreReturnBetween(series, weights, t.opened_at, t.closed_at)
    if (core == null) { line.unpriced++; total.unpriced++; continue }
    const net = Number(t.realized_pnl_usd ?? 0) - notional * roundTripCostBps(t.asset_class) / 10_000
    const coreUsd = notional * core
    for (const l of [line, total]) {
      l.trades++
      l.notionalUsd += notional
      l.netUsd += net
      l.coreUsd += coreUsd
      l.excessUsd += net - coreUsd
    }
    if (!first || t.opened_at < first) first = t.opened_at
  }
  const finish = (l: VsCoreLine) => ({ ...l, excessPct: l.notionalUsd > 0 ? l.excessUsd / l.notionalUsd : null })
  return {
    // Worst first; strategies with nothing comparable go last (their $0 means "unknown", not "even").
    perStrategy: [...by.entries()].map(([strategyKey, l]) => ({ strategyKey, ...finish(l) }))
      .sort((a, b) => (a.trades === 0 ? Infinity : a.excessUsd) - (b.trades === 0 ? Infinity : b.excessUsd)),
    total: finish(total),
    firstTradeAt: first,
    daysCovered: first ? Math.floor((now.getTime() - new Date(first).getTime()) / 86_400_000) : 0,
  }
}

export interface ShrinkVerdict {
  propose: boolean
  /** Plain-English reason (shown either way). */
  reason: string
  currentCapFraction: number
  /** Only set when proposing; always lower than the current limit. */
  newCapFraction: number | null
}

const pct = (f: number) => `${Math.round(f * 1000) / 10}%`

/**
 * The manager's call. Proposes a SMALLER Explore limit only when Explore's
 * trades, after costs, trailed the same dollars in Core over a meaningful
 * stretch. Never proposes a larger limit; never proposes below the floor.
 */
export function shrinkVerdict(c: ExploreVsCore, args: { currentCapFraction: number; snoozedUntil: string | null; now?: Date }): ShrinkVerdict {
  const now = args.now ?? new Date()
  const current = args.currentCapFraction
  const base = { currentCapFraction: current, newCapFraction: null }
  if (c.total.trades < EXPLORE_REVIEW_MIN_TRADES) {
    return { ...base, propose: false, reason: `Not enough history yet: ${c.total.trades} of ${EXPLORE_REVIEW_MIN_TRADES} closed Explore trades compared.` }
  }
  if (c.daysCovered < EXPLORE_REVIEW_MIN_DAYS) {
    return { ...base, propose: false, reason: `Not enough time yet: ${c.daysCovered} of ${EXPLORE_REVIEW_MIN_DAYS} days of Explore history.` }
  }
  if (c.total.excessUsd >= 0) {
    return { ...base, propose: false, reason: 'Explore is ahead of simply holding your Core funds — it has earned its place so far.' }
  }
  if (current <= EXPLORE_MIN_CAP_FRACTION + 1e-9) {
    return { ...base, propose: false, reason: `Explore trails Core, and its limit is already at the ${pct(EXPLORE_MIN_CAP_FRACTION)} floor.` }
  }
  if (args.snoozedUntil && new Date(args.snoozedUntil) > now) {
    return { ...base, propose: false, reason: 'Explore trails Core; you asked to revisit this later.' }
  }
  const next = Math.max(EXPLORE_MIN_CAP_FRACTION, Math.round(current * EXPLORE_SHRINK_FACTOR * 1000) / 1000)
  return {
    currentCapFraction: current,
    newCapFraction: next,
    propose: next < current,
    reason: `Over ${c.daysCovered} days and ${c.total.trades} trades, Explore made $${Math.round(c.total.netUsd).toLocaleString('en-US')} after costs; ` +
      `the same dollars in your Core funds would have made $${Math.round(c.total.coreUsd).toLocaleString('en-US')}.`,
  }
}

export function shrinkSummary(v: ShrinkVerdict): string {
  return `Shrink my Explore limit from ${pct(v.currentCapFraction)} to ${pct(v.newCapFraction ?? v.currentCapFraction)} ` +
    'because it trailed my Core funds. Nothing is sold; new strategy trades wait until Explore fits the smaller limit.'
}
