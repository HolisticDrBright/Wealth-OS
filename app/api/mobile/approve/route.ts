/**
 * GET  /api/mobile/approve — the top pending decision in plain English.
 *      Ladder setup comes FIRST (Explore is $0 until Tier 1 Safety is
 *      funded); otherwise the pending Core rebalance. One shape for both:
 *      before/after bar, amount moved, estimated cost, estimated tax effect,
 *      the bad-year dollar drop before and after, the "do nothing" line, and
 *      the exact summary the user approves.
 * POST /api/mobile/approve — approve it ({ kind, approved_summary }).
 *      ladder_setup → approveLadderSetup (records the approval, then
 *      designates Tier 1). rebalance → records accept_rebalance, then runs
 *      the web's guarded rebalance path. Nothing happens without approval.
 *
 * Bad-year dollars derive from the same 20y S&P series as everywhere else,
 * scaled by the share of money exposed to the market.
 */

import { NextRequest, NextResponse } from 'next/server'
import { userClientFromBearer } from '@/lib/supabase/bearer'
import { runRebalanceScan } from '@/lib/workers/rebalance-scan'
import { fetchSpxMonthlyReturns } from '@/lib/planning/market-returns'
import { yearRangeUsd } from '@/lib/planning/goal-projection'
import { roundTripCostUsd } from '@/lib/costs/transaction-costs'
import { loadLadder, approveLadderSetup, ladderSetupSummary } from '@/lib/allocation/ladder-data'
import { ladderSetupAmount } from '@/lib/allocation/ladder'

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

export async function GET(req: NextRequest) {
  const ctx = await userClientFromBearer(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const [ladder, returns] = await Promise.all([
      loadLadder(ctx.supabase, ctx.userId),
      fetchSpxMonthlyReturns(),
    ])
    const investable = ladder.investableUsd

    // ── 1. Ladder setup (Tier 1 first) ──────────────────────────────────────
    const setupUsd = ladderSetupAmount(ladder)
    if (setupUsd > 0 && ladder.tier1.targetUsd != null && investable > 0) {
      const range = yearRangeUsd(investable, returns)
      const exposedBefore = 1 - ladder.tier1.heldUsd / investable
      const exposedAfter = 1 - (ladder.tier1.heldUsd + setupUsd) / investable
      return NextResponse.json({
        decision: {
          kind: 'ladder_setup',
          title: 'Set up your safety cushion',
          explanation:
            `Before anything is invested for the long term, ${usd(ladder.tier1.targetUsd)} should sit in a cash-like fund ` +
            `for emergencies and goals due soon. This moves ${usd(setupUsd)} of practice money there; Explore stays at $0 until it is done.`,
          change: {
            label: 'cash',
            beforePct: Math.round((ladder.tier1.heldUsd / investable) * 1000) / 10,
            afterPct: Math.round(((ladder.tier1.heldUsd + setupUsd) / investable) * 1000) / 10,
          },
          amountMovedUsd: Math.round(setupUsd),
          estimatedCostUsd: Math.round(roundTripCostUsd(setupUsd, 'stocks') * 100) / 100,
          estimatedTaxUsd: 0,
          taxNote: 'none — practice money, nothing real is sold',
          badYearBeforeUsd: range ? Math.round(range.badYearUsd * exposedBefore) : null,
          badYearAfterUsd: range ? Math.round(range.badYearUsd * exposedAfter) : null,
          doNothing:
            'If you do nothing, your safety cushion stays short and Explore stays at $0. Nothing happens until you approve.',
          summary: ladderSetupSummary(setupUsd, ladder.tier1.targetUsd),
        },
      })
    }

    // ── 2. Core rebalance ───────────────────────────────────────────────────
    const scan = await runRebalanceScan(ctx.supabase, ctx.userId, { executeTrades: false })
    if (!scan.trades.length) {
      return NextResponse.json({ decision: null })
    }

    const stockTrade = scan.trades.find(t => t.asset_class === 'stock')
    const beforeStockPct = stockTrade ? stockTrade.current_pct : null
    const afterStockPct = stockTrade ? stockTrade.target_pct : null

    const amountMovedUsd = scan.trades.reduce((s, t) => s + Math.abs(t.suggested_notional), 0) / 2
    const estimatedCostUsd = scan.trades.reduce(
      (s, t) => s + roundTripCostUsd(Math.abs(t.suggested_notional), t.asset_class) / 2, 0)

    const suggestions = scan.suggestions as Array<{ tax_drag_usd?: number | null }>
    const taxDragUsd = suggestions.reduce((s, r) => s + (r.tax_drag_usd ?? 0), 0)

    const range = yearRangeUsd(Math.max(1, investable), returns)
    const badYearBeforeUsd = range && beforeStockPct != null ? Math.round(range.badYearUsd * (beforeStockPct / 100)) : null
    const badYearAfterUsd = range && afterStockPct != null ? Math.round(range.badYearUsd * (afterStockPct / 100)) : null

    return NextResponse.json({
      decision: {
        kind: 'rebalance',
        title: 'Rebalance your core portfolio',
        explanation:
          'Part of your mix has grown past the share your plan calls for. This sells a little of what grew and buys what lagged to bring you back to plan.',
        change: beforeStockPct != null && afterStockPct != null
          ? { label: 'stocks', beforePct: beforeStockPct, afterPct: afterStockPct }
          : null,
        amountMovedUsd: Math.round(amountMovedUsd),
        estimatedCostUsd: Math.round(estimatedCostUsd * 100) / 100,
        estimatedTaxUsd: Math.round(taxDragUsd * 100) / 100,
        taxNote: null,
        badYearBeforeUsd,
        badYearAfterUsd,
        doNothing:
          'If you do nothing, your portfolio stays as it is and carries a bit more risk than you chose. Nothing happens until you approve.',
        summary:
          `Rebalance my core portfolio: move about ${usd(amountMovedUsd)} back to my plan, ` +
          `estimated cost about ${usd(estimatedCostUsd)}, estimated tax effect ${taxDragUsd > 0 ? `about ${usd(taxDragUsd)}` : 'none'}.`,
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

  const body = await req.json().catch(() => ({})) as { kind?: string; approved_summary?: string }
  const summary = body.approved_summary?.trim()
  // The phone flow ALWAYS approves explicitly — same bar as web simple mode.
  if (!summary) {
    return NextResponse.json({ error: 'approval_required: approved_summary missing' }, { status: 400 })
  }

  if (body.kind === 'ladder_setup') {
    const res = await approveLadderSetup(ctx.supabase, ctx.userId, summary)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
    return NextResponse.json({ ok: true, kind: 'ladder_setup', designatedUsd: res.designatedUsd, executed: 0, skippedOrders: [], errors: [] })
  }

  const { error: apprErr } = await ctx.supabase.from('automation_approvals').insert({
    user_id: ctx.userId, kind: 'accept_rebalance', subject: 'rebalance', summary,
  })
  if (apprErr) return NextResponse.json({ error: `could not record approval: ${apprErr.message}` }, { status: 500 })

  try {
    const result = await runRebalanceScan(ctx.supabase, ctx.userId, { executeTrades: true })
    return NextResponse.json({
      ok: true,
      kind: 'rebalance',
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
