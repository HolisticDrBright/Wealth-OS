/**
 * Track-record math (Phase 6) — PURE. Shared by the Strategy Health Board's
 * promotion pipeline and the read-only promotion-readiness page.
 *
 * "Net after costs" uses the same cost model as the promotion gate's net
 * expectancy: realized P&L (fills already paid modeled slippage) minus the
 * venue round-trip cost on each trade's notional.
 */

import { roundTripCostBps } from '@/lib/costs/transaction-costs'

export interface ClosedTradeRow {
  strategy_key: string
  realized_pnl_pct: number | null
  realized_pnl_usd: number | null
  notional_usd: number | null
  closed_at: string | null
  opened_at?: string | null
}

/** Worst peak-to-trough drop of cumulative realized P&L, as a fraction of average notional. */
export function computeDrawdown(rows: ClosedTradeRow[]): number | null {
  const ordered = rows
    .filter(r => r.closed_at != null)
    .sort((a, b) => (a.closed_at! < b.closed_at! ? -1 : 1))
  if (ordered.length < 5) return null

  const avgNotional = ordered.reduce((s, r) => s + (r.notional_usd ?? 0), 0) / ordered.length
  if (avgNotional <= 0) return null

  let equity = 0
  let peak = 0
  let maxDdUsd = 0
  for (const r of ordered) {
    equity += r.realized_pnl_usd ?? 0
    if (equity > peak) peak = equity
    maxDdUsd = Math.max(maxDdUsd, peak - equity)
  }
  return maxDdUsd / avgNotional
}

export interface TrackRecordSummary {
  closedTrades: number
  grossPnlUsd: number
  costsUsd: number
  netAfterCostsUsd: number
  avgReturnPct: number | null
  maxDrawdownPct: number | null
  firstTradeAt: string | null
  lastTradeAt: string | null
}

export function summarizeTrackRecord(rows: ClosedTradeRow[], assetClass: string): TrackRecordSummary {
  const bps = roundTripCostBps(assetClass) / 10_000
  const grossPnlUsd = rows.reduce((s, r) => s + (r.realized_pnl_usd ?? 0), 0)
  const costsUsd = rows.reduce((s, r) => s + Math.abs(r.notional_usd ?? 0) * bps, 0)
  const returns = rows.map(r => r.realized_pnl_pct).filter((v): v is number => typeof v === 'number')
  const times = rows.flatMap(r => [r.opened_at, r.closed_at]).filter((t): t is string => !!t).sort()
  return {
    closedTrades: rows.length,
    grossPnlUsd,
    costsUsd,
    netAfterCostsUsd: grossPnlUsd - costsUsd,
    avgReturnPct: returns.length ? returns.reduce((s, v) => s + v, 0) / returns.length : null,
    maxDrawdownPct: computeDrawdown(rows),
    firstTradeAt: times[0] ?? null,
    lastTradeAt: times[times.length - 1] ?? null,
  }
}
