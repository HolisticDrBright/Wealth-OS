/**
 * Transaction Cost Analysis (Gap Analysis #3) — measure cost REALITY, not
 * just estimates: realized slippage per venue/strategy vs the model in
 * transaction-costs.ts. When the real Polymarket round trip proves 220bps
 * not 300, sizing improves; when fills degrade, it's visible before the P&L.
 */

import { oneWayCostBps } from './transaction-costs'

export interface FillRecord {
  assetClass: string
  strategyKey: string
  slippageBps: number
}

export interface TcaRow {
  assetClass: string
  strategyKey: string | null
  fills: number
  realizedOneWayBps: number
  modeledOneWayBps: number
  /** realized − modeled: positive = the model UNDERSTATES real costs. */
  shortfallBps: number
}

/** Implementation-shortfall report grouped by venue, then venue×strategy. */
export function implementationShortfall(fills: FillRecord[]): TcaRow[] {
  const groups = new Map<string, { assetClass: string; strategyKey: string | null; slips: number[] }>()
  for (const f of fills) {
    if (!Number.isFinite(f.slippageBps)) continue
    for (const key of [`${f.assetClass}|`, `${f.assetClass}|${f.strategyKey}`]) {
      if (!groups.has(key)) {
        groups.set(key, {
          assetClass: f.assetClass,
          strategyKey: key.endsWith('|') ? null : f.strategyKey,
          slips: [],
        })
      }
      groups.get(key)!.slips.push(Math.abs(f.slippageBps))
    }
  }

  const rows: TcaRow[] = []
  for (const g of groups.values()) {
    const realized = g.slips.reduce((s, v) => s + v, 0) / g.slips.length
    const modeled = oneWayCostBps(g.assetClass)
    rows.push({
      assetClass: g.assetClass,
      strategyKey: g.strategyKey,
      fills: g.slips.length,
      realizedOneWayBps: Math.round(realized * 10) / 10,
      modeledOneWayBps: modeled,
      shortfallBps: Math.round((realized - modeled) * 10) / 10,
    })
  }
  return rows.sort((a, b) => Math.abs(b.shortfallBps) - Math.abs(a.shortfallBps))
}
