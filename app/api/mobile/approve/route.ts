/**
 * GET  /api/mobile/approve — the pending rebalance decision in plain English:
 *      before/after allocation bars, amount moved, estimated cost, estimated
 *      tax effect, and the bad-year dollar drop before and after.
 * POST /api/mobile/approve — approve it ({ approved_summary }). Executes via
 *      the SAME path as the web (runRebalanceScan executeTrades: true, which
 *      runs the pre-execution guard per order) and records the approval.
 *
 * Bad-year dollars derive from the same 20y S&P series as everywhere else:
 * the series IS 100% stocks, so a mix holding X% stocks is scaled by X%.
 */

import { NextRequest, NextResponse } from 'next/server'
import { userClientFromBearer } from '@/lib/supabase/bearer'
import { runRebalanceScan } from '@/lib/workers/rebalance-scan'
import { fetchSpxMonthlyReturns } from '@/lib/planning/market-returns'
import { yearRangeUsd } from '@/lib/planning/goal-projection'
import { roundTripCostUsd } from '@/lib/costs/transaction-costs'

export async function GET(req: NextRequest) {
  const ctx = await userClientFromBearer(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const [scan, returns, assetsRes] = await Promise.all([
      runRebalanceScan(ctx.supabase, ctx.userId, { executeTrades: false }),
      fetchSpxMonthlyReturns(),
      ctx.supabase.from('assets').select('current_value').eq('user_id', ctx.userId),
    ])

    if (!scan.trades.length) {
      return NextResponse.json({ decision: null })
    }

    const totalValueUsd = ((assetsRes.data ?? []) as Array<{ current_value: number | null }>)
      .reduce((s, r) => s + (r.current_value ?? 0), 0)

    // Before/after stock share from the scan's drift numbers.
    const stockTrade = scan.trades.find(t => t.asset_class === 'stock')
    const beforeStockPct = stockTrade ? stockTrade.current_pct : null
    const afterStockPct = stockTrade ? stockTrade.target_pct : null

    const amountMovedUsd = scan.trades.reduce((s, t) => s + Math.abs(t.suggested_notional), 0) / 2
    const estimatedCostUsd = scan.trades.reduce(
      (s, t) => s + roundTripCostUsd(Math.abs(t.suggested_notional), t.asset_class) / 2, 0)

    const suggestions = scan.suggestions as Array<{ tax_drag_usd?: number | null }>
    const taxDragUsd = suggestions.reduce((s, r) => s + (r.tax_drag_usd ?? 0), 0)

    const range = yearRangeUsd(Math.max(1, totalValueUsd), returns)
    const badYearBeforeUsd = range && beforeStockPct != null
      ? Math.round(range.badYearUsd * (beforeStockPct / 100)) : null
    const badYearAfterUsd = range && afterStockPct != null
      ? Math.round(range.badYearUsd * (afterStockPct / 100)) : null

    return NextResponse.json({
      decision: {
        title: 'Rebalance your core portfolio',
        explanation:
          'Part of your mix has grown past the share your plan calls for. This sells a little of what grew and buys what lagged to bring you back to plan.',
        trades: scan.trades.map(t => ({
          assetClass: t.asset_class, action: t.action,
          currentPct: t.current_pct, targetPct: t.target_pct,
          suggestedNotionalUsd: t.suggested_notional,
        })),
        amountMovedUsd: Math.round(amountMovedUsd),
        estimatedCostUsd: Math.round(estimatedCostUsd * 100) / 100,
        estimatedTaxUsd: Math.round(taxDragUsd * 100) / 100,
        badYearBeforeUsd,
        badYearAfterUsd,
        doNothing:
          'If you do nothing, your portfolio stays as it is and carries a bit more risk than you chose. Nothing happens until you approve.',
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to load decision' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const ctx = await userClientFromBearer(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { approved_summary?: string }
  const summary = body.approved_summary?.trim()
  // The phone flow ALWAYS approves explicitly — same bar as web simple mode.
  if (!summary) {
    return NextResponse.json({ error: 'approval_required: approved_summary missing' }, { status: 400 })
  }

  const { error: apprErr } = await ctx.supabase.from('automation_approvals').insert({
    user_id: ctx.userId, kind: 'accept_rebalance', subject: 'rebalance', summary,
  })
  if (apprErr) return NextResponse.json({ error: `could not record approval: ${apprErr.message}` }, { status: 500 })

  try {
    const result = await runRebalanceScan(ctx.supabase, ctx.userId, { executeTrades: true })
    return NextResponse.json({
      ok: true,
      executed: result.executed,
      skippedOrders: result.skipped_orders ?? [],
      errors: result.errors ?? [],
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'rebalance failed' },
      { status: 500 }
    )
  }
}
