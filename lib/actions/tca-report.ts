'use server'

/**
 * TCA surface (R3a): realized vs modeled cost per venue/strategy from real
 * fill slippage. Venues drifting >25% from the model are flagged; measured
 * costs can be promoted to cost_overrides (the edge gate then uses them).
 */

import { createClient } from '@/lib/supabase/server'
import { implementationShortfall, type TcaRow } from '@/lib/costs/tca'

export interface TcaReport {
  rows: Array<TcaRow & { driftPct: number; flagged: boolean }>
  fills: number
}

const DRIFT_FLAG = 0.25

export async function getTcaReport(): Promise<TcaReport | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('paper_trades')
    .select('asset_class, strategy_key, slippage_bps')
    .eq('user_id', user.id)
    .not('slippage_bps', 'is', null)
    .limit(5000)

  const fills = ((data ?? []) as Array<{ asset_class: string; strategy_key: string; slippage_bps: number }>)
    .map(r => ({ assetClass: r.asset_class, strategyKey: r.strategy_key, slippageBps: r.slippage_bps }))

  const rows = implementationShortfall(fills).map(r => {
    const driftPct = r.modeledOneWayBps > 0
      ? Math.round((r.realizedOneWayBps / r.modeledOneWayBps - 1) * 1000) / 10
      : 0
    return { ...r, driftPct, flagged: Math.abs(driftPct) > DRIFT_FLAG * 100 }
  })

  return { rows, fills: fills.length }
}
