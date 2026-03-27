import type { Asset, PortfolioTarget, RebalanceSuggestion } from './types'

export interface RebalanceTrade {
  asset_class: string
  action: 'buy' | 'sell'
  current_pct: number
  target_pct: number
  drift_pct: number
  suggested_notional: number
}

/**
 * Computes rebalancing trades needed to move from current allocation to targets.
 * Only includes asset classes that have drifted beyond the threshold.
 */
export function computeRebalanceTrades(
  assets: Asset[],
  targets: PortfolioTarget[],
  thresholdPct = 5
): RebalanceTrade[] {
  const totalValue = assets.reduce((s, a) => s + a.current_value, 0)
  if (totalValue === 0) return []

  // Compute current allocation by asset_class (mapped from category)
  const currentByClass: Record<string, number> = {}
  for (const asset of assets) {
    const cls = asset.category === 'stock' ? 'stock'
      : asset.category === 'crypto' ? 'crypto'
      : asset.category === 'bond' ? 'bond'
      : asset.category === 'real_estate' ? 'real_estate'
      : asset.category === 'cash' ? 'cash'
      : 'other'
    currentByClass[cls] = (currentByClass[cls] ?? 0) + asset.current_value
  }

  const trades: RebalanceTrade[] = []

  for (const target of targets) {
    const currentValue = currentByClass[target.asset_class] ?? 0
    const currentPct = (currentValue / totalValue) * 100
    const drift = currentPct - target.target_pct

    if (Math.abs(drift) < thresholdPct) continue

    const targetValue = (target.target_pct / 100) * totalValue
    const delta = targetValue - currentValue

    trades.push({
      asset_class: target.asset_class,
      action: delta > 0 ? 'buy' : 'sell',
      current_pct: currentPct,
      target_pct: target.target_pct,
      drift_pct: drift,
      suggested_notional: Math.abs(delta),
    })
  }

  // Sort by largest drift first
  return trades.sort((a, b) => Math.abs(b.drift_pct) - Math.abs(a.drift_pct))
}

/** Default target allocations for a moderate risk profile */
export const DEFAULT_TARGETS: Omit<PortfolioTarget, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] = [
  { asset_class: 'stock',    target_pct: 50 },
  { asset_class: 'crypto',   target_pct: 20 },
  { asset_class: 'bond',     target_pct: 15 },
  { asset_class: 'cash',     target_pct: 10 },
  { asset_class: 'other',    target_pct:  5 },
]
