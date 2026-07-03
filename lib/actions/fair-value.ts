'use server'

/**
 * Model-vs-market fair value (UI brief widget 8) — for Polymarket fills,
 * plot the strategy's OWN probability estimate against the market price paid
 * at entry. Edge = distance above the diagonal; points on it mean no edge.
 * Model probabilities are read from recorded fill metadata — nothing is
 * fabricated for strategies that don't produce a probability.
 */

import { createClient } from '@/lib/supabase/server'

export interface FairValuePoint {
  at: string
  symbol: string
  strategyKey: string
  /** Market price paid at entry (0–1). */
  marketPrice: number
  /** Strategy model probability of resolution (0–1). */
  modelProb: number
}

interface TradeRow {
  created_at: string
  strategy_key: string
  symbol: string
  side: string
  fill_price: number
  metadata: Record<string, unknown> | null
}

/** Extract a model probability from known per-strategy metadata shapes. */
function modelProbOf(strategyKey: string, m: Record<string, unknown>): number | null {
  // info-lag stores the externally-derived true probability directly
  const trueProb = m.trueProbability ?? m.true_probability
  if (typeof trueProb === 'number' && trueProb > 0 && trueProb < 1) return trueProb

  // base-rate strategies store their calibrated prior
  const baseRate = m.baseRate ?? m.base_rate
  if (typeof baseRate === 'number' && baseRate > 0 && baseRate < 1) return baseRate

  // 5-min binary: deviation-implied win probability (same formula as sizing)
  if (strategyKey === 'polymarket_crypto_binary_5min') {
    const deviation = m.offChainDeviation
    if (typeof deviation === 'number' && deviation > 0) {
      return Math.min(0.85, 0.55 + deviation / 500)
    }
  }
  return null
}

export async function getFairValuePoints(limit = 200): Promise<FairValuePoint[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('paper_trades')
    .select('created_at, strategy_key, symbol, side, fill_price, metadata')
    .eq('user_id', user.id)
    .eq('asset_class', 'polymarket')
    .eq('side', 'open')
    .order('created_at', { ascending: false })
    .limit(limit)

  const points: FairValuePoint[] = []
  for (const r of (data ?? []) as TradeRow[]) {
    if (!r.metadata || r.fill_price <= 0 || r.fill_price >= 1) continue
    const modelProb = modelProbOf(r.strategy_key, r.metadata)
    if (modelProb == null) continue
    points.push({
      at: r.created_at,
      symbol: r.symbol,
      strategyKey: r.strategy_key,
      marketPrice: Math.round(r.fill_price * 1000) / 1000,
      modelProb: Math.round(modelProb * 1000) / 1000,
    })
  }
  return points
}
