import type { Asset, PortfolioTarget } from './types'

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
 *
 * Shares are measured over the asset classes the targets cover. Holdings with
 * no target (e.g. crypto, which lives in Explore, or real estate) are outside
 * the rebalance — counting them in the denominator made targets that sum to
 * 100% unreachable and produced buys with no matching sells.
 *
 * Default targets come from lib/allocation/policy.ts (defaultRebalanceTargets).
 */
export function computeRebalanceTrades(
  assets: Asset[],
  targets: Array<Pick<PortfolioTarget, 'asset_class' | 'target_pct'>>,
  thresholdPct = 5
): RebalanceTrade[] {
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

  const targeted = new Set(targets.map(t => t.asset_class))
  const totalValue = Object.entries(currentByClass)
    .filter(([cls]) => targeted.has(cls))
    .reduce((s, [, v]) => s + v, 0)
  if (totalValue === 0) return []

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
