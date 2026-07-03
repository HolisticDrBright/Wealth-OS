'use server'

/**
 * Live trade tape (UI brief widget 6) — every fill with its provenance:
 * the strategy and the reasoning that produced it (widget 2, compact form).
 * Trust feature: no fill without a visible why.
 */

import { createClient } from '@/lib/supabase/server'

export interface TapeFill {
  id: string
  at: string
  strategyKey: string
  symbol: string
  assetClass: string
  direction: string
  side: 'open' | 'close'
  fillPrice: number
  notionalUsd: number
  slippageBps: number | null
  /** The signal reasoning that produced this fill (provenance). */
  reasoning: string | null
  exitReason: string | null
  pnlUsd: number | null
}

interface TradeRow {
  id: string
  created_at: string
  strategy_key: string
  symbol: string
  asset_class: string
  direction: string
  side: string
  fill_price: number
  notional_usd: number
  slippage_bps: number | null
  metadata: Record<string, unknown> | null
}

export async function getTradeTape(limit = 40): Promise<TapeFill[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('paper_trades')
    .select('id, created_at, strategy_key, symbol, asset_class, direction, side, fill_price, notional_usd, slippage_bps, metadata')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  return ((data ?? []) as TradeRow[]).map(r => ({
    id: r.id,
    at: r.created_at,
    strategyKey: r.strategy_key,
    symbol: r.symbol,
    assetClass: r.asset_class,
    direction: r.direction,
    side: r.side === 'close' ? 'close' : 'open',
    fillPrice: r.fill_price,
    notionalUsd: r.notional_usd,
    slippageBps: r.slippage_bps,
    reasoning: (r.metadata?.reasoning as string | undefined) ?? null,
    exitReason: (r.metadata?.exit_reason as string | undefined) ?? null,
    pnlUsd: (r.metadata?.pnl_usd as number | undefined) ?? null,
  }))
}
