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
  /** Relational provenance (W6): the decision and order intent behind the fill. */
  decisionId: string | null
  orderIntentId: string | null
  decisionConfidence: number | null
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
  position_id: string | null
  opportunity_id: string | null
  metadata: Record<string, unknown> | null
}

export async function getTradeTape(limit = 40): Promise<TapeFill[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('paper_trades')
    .select('id, created_at, strategy_key, symbol, asset_class, direction, side, fill_price, notional_usd, slippage_bps, position_id, opportunity_id, metadata')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  const rows = (data ?? []) as TradeRow[]

  // Relational provenance joins (W6): decision_log via position_id and
  // order_intents via opportunity_id — real keys, not metadata breadcrumbs.
  const positionIds = [...new Set(rows.map(r => r.position_id).filter((v): v is string => !!v))]
  const oppIds = [...new Set(rows.map(r => r.opportunity_id).filter((v): v is string => !!v))]

  const [decisions, intents] = await Promise.all([
    positionIds.length
      ? supabase
          .from('decision_log')
          .select('id, paper_position_id, confidence')
          .eq('user_id', user.id)
          .in('paper_position_id', positionIds)
          .then(r => (r.data ?? []) as Array<{ id: string; paper_position_id: string; confidence: number | null }>)
      : Promise.resolve([] as Array<{ id: string; paper_position_id: string; confidence: number | null }>),
    oppIds.length
      ? supabase
          .from('order_intents')
          .select('id, opportunity_id, leg')
          .eq('user_id', user.id)
          .in('opportunity_id', oppIds)
          .eq('leg', 'entry')
          .then(r => (r.data ?? []) as Array<{ id: string; opportunity_id: string; leg: string }>)
      : Promise.resolve([] as Array<{ id: string; opportunity_id: string; leg: string }>),
  ])

  const decisionByPosition = new Map(decisions.map(d => [d.paper_position_id, d]))
  const intentByOpportunity = new Map(intents.map(i => [i.opportunity_id, i]))

  return rows.map(r => {
    const decision = r.position_id ? decisionByPosition.get(r.position_id) : undefined
    const intent = r.opportunity_id ? intentByOpportunity.get(r.opportunity_id) : undefined
    return {
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
      decisionId: decision?.id ?? null,
      orderIntentId: intent?.id ?? null,
      decisionConfidence: decision?.confidence ?? null,
    }
  })
}
