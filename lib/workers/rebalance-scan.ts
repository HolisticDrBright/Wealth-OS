/**
 * Rebalance scan worker — the /api/rebalance POST body as a direct-call
 * function (Phase 1.2). The route authenticates the user then calls this;
 * the cron calls it per user with executeTrades=false (suggestions only —
 * the scheduler never places orders by itself).
 */

import type { createAdminClient } from '@/lib/supabase/admin'
import { computeRebalanceTrades } from '@/lib/rebalance-engine'
import { defaultRebalanceTargets, fundForAssetClass } from '@/lib/allocation/policy'
import { submitOrder } from '@/lib/broker-adapters/router'
import { preExecutionGuard, DEFAULT_MANUAL_EDGE, costVenueOf } from '@/lib/broker-adapters/execution-guard'
import { checkWashSaleBlocklist } from '@/lib/tax/wash-sale-guard'
import { estimateRebalanceTaxDrag } from '@/lib/tax/tax-aware-rebalance'
import type { Asset, PortfolioTarget } from '@/lib/types'

type AdminClient = ReturnType<typeof createAdminClient>

/** Representative symbol per asset class (mirrors the execution mapping below). */
function representativeSymbol(assetClass: string): string {
  // Core classes trade through the configured funds (allocation policy);
  // crypto only appears when a user's OWN saved targets include it.
  return fundForAssetClass(assetClass) ?? (assetClass === 'crypto' ? 'BTC' : assetClass)
}

export interface RebalanceScanResult {
  trades: ReturnType<typeof computeRebalanceTrades>
  suggestions: unknown[]
  executed: number
  skipped_orders?: string[]
  errors?: string[]
  message?: string
}

export async function runRebalanceScan(
  supabase: AdminClient,
  userId: string,
  opts: { executeTrades?: boolean; thresholdPct?: number } = {}
): Promise<RebalanceScanResult> {
  const executeTrades = opts.executeTrades ?? false
  const thresholdPct = opts.thresholdPct ?? 5

  // Fetch user assets and targets
  const [assetsRes, targetsRes, profileRes] = await Promise.all([
    supabase.from('assets').select('*').eq('user_id', userId),
    supabase.from('portfolio_targets').select('*').eq('user_id', userId),
    supabase.from('user_risk_profile').select('profile_key').eq('user_id', userId).maybeSingle(),
  ])

  const assets = (assetsRes.data ?? []) as Asset[]
  let targets = (targetsRes.data ?? []) as PortfolioTarget[]

  // Use the allocation policy's defaults if the user hasn't set targets.
  if (!targets.length) {
    const profileKey = (profileRes.data?.profile_key as string | undefined) ?? null
    targets = defaultRebalanceTargets(profileKey).map(t => ({
      ...t, id: '', user_id: userId, created_at: '', updated_at: '',
    }))
  }

  const trades = computeRebalanceTrades(assets, targets, thresholdPct)

  if (!trades.length) {
    return { trades: [], suggestions: [], executed: 0, message: 'Portfolio is within rebalance threshold' }
  }

  // Tax layer: wash-sale guard on BUYs, estimated tax drag on SELLs.
  const taxMeta = new Map<string, { tax_drag_usd: number | null; tax_warning: string | null; blocked_reason: string | null }>()

  for (const t of trades) {
    const meta = { tax_drag_usd: null as number | null, tax_warning: null as string | null, blocked_reason: null as string | null }

    if (t.action === 'buy') {
      // Buying back a recently harvested symbol would disallow the loss.
      const block = await checkWashSaleBlocklist(supabase, userId, representativeSymbol(t.asset_class))
      if (block.blocked) meta.blocked_reason = `Wash-sale window: ${block.reason}`
    } else {
      const drag = estimateRebalanceTaxDrag(assets, t.asset_class, t.suggested_notional)
      meta.tax_drag_usd = drag.taxDragUsd
      if (drag.sellsShortTermGains) meta.tax_warning = 'short_term_gains'
      else if (drag.harvestsLosses) meta.tax_warning = 'harvests_losses'
    }

    taxMeta.set(t.asset_class, meta)
  }

  // Write suggestions to DB
  await supabase.from('rebalance_suggestions').delete().eq('user_id', userId).eq('status', 'pending')

  const { data: suggestions } = await supabase
    .from('rebalance_suggestions')
    .insert(trades.map(t => ({
      user_id: userId,
      asset_class: t.asset_class,
      action: t.action,
      current_pct: t.current_pct,
      target_pct: t.target_pct,
      drift_pct: t.drift_pct,
      suggested_notional: t.suggested_notional,
      status: 'pending',
      ...taxMeta.get(t.asset_class),
    })))
    .select()

  let executed = 0
  const errors: string[] = []
  const skippedOrders: string[] = []

  if (executeTrades) {
    for (const trade of trades) {
      // Never execute a buy that is inside a wash-sale window.
      const meta = taxMeta.get(trade.asset_class)
      if (trade.action === 'buy' && meta?.blocked_reason) {
        errors.push(`${trade.asset_class}: skipped — ${meta.blocked_reason}`)
        continue
      }
      // Pre-execution guard per order: kill switch + sleeve halts + cost
      // gate (conservative default edge — high-cost venues are refused).
      const guard = await preExecutionGuard({
        supabase,
        userId,
        expectedReturn: DEFAULT_MANUAL_EDGE,
        assetClass: costVenueOf(trade.asset_class),
      })
      if (!guard.ok) {
        errors.push(`${trade.asset_class}: blocked — ${guard.reason}`)
        await supabase.from('audit_logs').insert({
          user_id: userId, strategy_key: 'rebalance', symbol: trade.asset_class,
          decision: 'block', size_fraction: 0, mirofish_used: false, kronos_used: false,
          decided_at: new Date().toISOString(),
          metadata: { blocked_by: 'pre_execution_guard', reason: guard.reason, route: '/api/rebalance' },
        }).then(() => {}, () => {})
        continue
      }
      const result = await submitOrder({
        symbol: representativeSymbol(trade.asset_class),
        asset_class: trade.asset_class,
        side: trade.action,
        order_type: 'market',
        notional_usd: trade.suggested_notional,
        jurisdiction: 'US',
      }, guard.token)

      if (result.status === 'open' || result.status === 'submitted') {
        executed++
        // Mark suggestion executed
        const suggestion = suggestions?.find(s => s.asset_class === trade.asset_class)
        if (suggestion) {
          await supabase.from('rebalance_suggestions')
            .update({ status: 'executed', executed_at: new Date().toISOString() })
            .eq('id', suggestion.id)
        }
      } else if (result.status === 'skipped') {
        // No broker order was placed — say so instead of silently dropping it.
        skippedOrders.push(`${trade.asset_class}: no order placed — ${result.reason ?? 'skipped'}`)
      } else if (result.status === 'failed') {
        errors.push(`${trade.asset_class}: ${result.error}`)
      }
    }
  }

  return {
    trades,
    suggestions: suggestions ?? [],
    executed,
    skipped_orders: skippedOrders.length ? skippedOrders : undefined,
    errors: errors.length ? errors : undefined,
  }
}
