/**
 * Tax-loss-harvest scan worker — the /api/tax-harvest POST body as a
 * direct-call function (Phase 1.2). Writes harvest_candidates rows; it never
 * sells anything. The route authenticates the user then calls this; the cron
 * calls it per user with open losing positions.
 */

import type { createAdminClient } from '@/lib/supabase/admin'
import { checkWashSaleRisk } from '@/lib/wash-sale-checker'
import { suggestReplacement } from '@/lib/tax/replacement'

type AdminClient = ReturnType<typeof createAdminClient>

export interface HarvestScanResult {
  candidates: unknown[]
  scanned: number
}

export async function runHarvestScan(
  supabase: AdminClient,
  userId: string,
  opts: { thresholdUsd?: number; thresholdPct?: number } = {}
): Promise<HarvestScanResult> {
  const thresholdUsd = opts.thresholdUsd ?? 250
  const thresholdPct = opts.thresholdPct ?? 3

  // Fetch open positions with losses
  const { data: positions } = await supabase
    .from('user_copied_positions')
    .select('id, symbol, asset_class, notional_value, pnl_usd, pnl_pct, opened_at')
    .eq('user_id', userId)
    .eq('status', 'open')
    .lt('pnl_usd', -thresholdUsd)

  if (!positions?.length) {
    return { candidates: [], scanned: 0 }
  }

  // Get recent trade history for wash-sale check
  const { data: recentTrades } = await supabase
    .from('user_copied_positions')
    .select('symbol, action, opened_at')
    .eq('user_id', userId)
    .gte('opened_at', new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString())

  const tradeLike = (recentTrades ?? []).map(t => ({
    symbol: t.symbol,
    action: t.action,
    trade_date: t.opened_at,
  }))

  // Clear old pending candidates
  await supabase.from('harvest_candidates').delete().eq('user_id', userId).eq('status', 'pending')

  const candidates = []

  for (const pos of positions) {
    const lossPct = Math.abs(pos.pnl_pct ?? 0)
    if (lossPct < thresholdPct) continue

    const washSale = checkWashSaleRisk(pos.symbol, tradeLike)
    const replacement = suggestReplacement(pos.symbol, pos.asset_class)

    const { data: candidate } = await supabase
      .from('harvest_candidates')
      .insert({
        user_id: userId,
        symbol: pos.symbol,
        asset_class: pos.asset_class,
        position_id: pos.id,
        unrealized_loss_usd: pos.pnl_usd,
        unrealized_loss_pct: pos.pnl_pct,
        purchase_date: pos.opened_at ? new Date(pos.opened_at).toISOString().split('T')[0] : null,
        wash_sale_risk: washSale.has_wash_sale_risk,
        replacement_symbol: replacement,
        status: 'pending',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: {
          wash_sale_reason: washSale.reason,
          wash_sale_window_end: washSale.window_end,
        },
      })
      .select()
      .single()

    if (candidate) candidates.push(candidate)
  }

  return { candidates, scanned: positions.length }
}
