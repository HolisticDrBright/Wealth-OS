/**
 * GET  /api/mobile/approve — the top pending decision in plain English, in
 *      ladder order: the one-tap ladder setup first (Explore is $0 until
 *      Tier 1 Safety is funded), then a Core fund rebalance (raised only when
 *      Core drifts past CORE_DRIFT_THRESHOLD), then the legacy recorded-account
 *      rebalance. One shape for all: before/after bar, amount moved, estimated
 *      cost, estimated tax effect, the bad-year dollar drop before and after,
 *      the "do nothing" line, and the exact summary the user approves.
 * POST /api/mobile/approve — approve it ({ kind, approved_summary }).
 *      ladder_setup   → approveLadderSetup   (records approval, then paper fund buys)
 *      core_rebalance → approveCoreRebalance (records approval, then paper fund trades)
 *      explore_shrink → approveExploreShrink (records approval, then LOWERS the Explore limit; nothing sold)
 *      rebalance      → records accept_rebalance, then the web's guarded rebalance path.
 *      Nothing happens without approval. Core is never traded automatically.
 *
 * Bad-year dollars come from the ACTUAL tier mix (lib/allocation/bad-year.ts):
 * Safety doesn't drop, Core stocks and bonds move like their own histories.
 */

import { NextRequest, NextResponse } from 'next/server'
import { userClientFromBearer } from '@/lib/supabase/bearer'
import { runRebalanceScan } from '@/lib/workers/rebalance-scan'
import { fetchSpxMonthlyReturns, fetchMonthlyReturns } from '@/lib/planning/market-returns'
import { roundTripCostUsd } from '@/lib/costs/transaction-costs'
import {
  loadLadder, approveLadderSetup, ladderSetupSummary, approveCoreRebalance, coreRebalanceSummary,
} from '@/lib/allocation/ladder-data'
import { planLadderSetup, setupNeeded, coreDrift, planCoreRebalance, type FundTrade } from '@/lib/allocation/core-plans'
import { tierMixOf, mixAfterTrades, yearRangeForMix } from '@/lib/allocation/bad-year'
import { CORE_FUNDS } from '@/lib/config/product-defaults'
import { loadExploreVsCore, approveExploreShrink } from '@/lib/explore/vs-core-data'

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const pct = (n: number) => Math.round(n * 1000) / 10
const oneWayCost = (trades: FundTrade[]) =>
  Math.round(trades.reduce((s, t) => s + roundTripCostUsd(t.usd, 'stocks') / 2, 0) * 100) / 100

export async function GET(req: NextRequest) {
  const ctx = await userClientFromBearer(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const [ladder, stockReturns, bondReturns] = await Promise.all([
      loadLadder(ctx.supabase, ctx.userId),
      fetchSpxMonthlyReturns(),
      fetchMonthlyReturns(CORE_FUNDS.bonds),
    ])
    const investable = ladder.investableUsd
    const mixBefore = tierMixOf(ladder)
    const badYear = (trades: FundTrade[]) => {
      const before = yearRangeForMix(mixBefore, stockReturns, bondReturns)
      const after = yearRangeForMix(mixAfterTrades(mixBefore, trades, ladder), stockReturns, bondReturns)
      return { badYearBeforeUsd: before?.badYearUsd ?? null, badYearAfterUsd: after?.badYearUsd ?? null }
    }

    // ── 1. Ladder setup (Tier 1 first, then Core) ───────────────────────────
    if (setupNeeded(ladder) && investable > 0) {
      const trades = planLadderSetup(ladder)
      const safetyUsd = trades.filter(t => t.sleeve === 'safety').reduce((s, t) => s + t.usd, 0)
      const coreUsd = trades.filter(t => t.sleeve === 'core').reduce((s, t) => s + t.usd, 0)
      const change = safetyUsd > 0
        ? { label: 'safety cushion', beforePct: pct(ladder.tier1.heldUsd / investable), afterPct: pct((ladder.tier1.heldUsd + safetyUsd) / investable) }
        : { label: 'core funds', beforePct: pct(ladder.core.heldUsd / investable), afterPct: pct((ladder.core.heldUsd + coreUsd) / investable) }
      return NextResponse.json({
        decision: {
          kind: 'ladder_setup',
          title: safetyUsd > 0 ? 'Set up your money ladder' : 'Invest your core',
          explanation:
            (safetyUsd > 0
              ? `First, ${usd(ladder.tier1.targetUsd ?? 0)} should sit in a cash-like fund (${CORE_FUNDS.cashLike}) for emergencies and goals due soon. `
              : '') +
            (coreUsd > 0
              ? `Long-term money goes into broad, low-cost funds (${trades.filter(t => t.sleeve === 'core').map(t => t.symbol).join(', ')}). `
              : '') +
            'Explore stays small and capped. Practice money.',
          change,
          amountMovedUsd: Math.round(safetyUsd + coreUsd),
          estimatedCostUsd: oneWayCost(trades),
          estimatedTaxUsd: 0,
          taxNote: 'none — practice money, nothing real is sold',
          ...badYear(trades),
          doNothing: ladder.tier1.funded
            ? 'If you do nothing, your long-term money stays uninvested. Nothing happens until you approve.'
            : 'If you do nothing, your safety cushion stays short and Explore stays at $0. Nothing happens until you approve.',
          summary: ladderSetupSummary(trades),
        },
      })
    }

    // ── 2. Core fund rebalance (drift past CORE_DRIFT_THRESHOLD) ────────────
    const drift = coreDrift(ladder)
    if (drift.needsRebalance && drift.heldStockShare != null) {
      const trades = planCoreRebalance(ladder)
      return NextResponse.json({
        decision: {
          kind: 'core_rebalance',
          title: 'Rebalance your core funds',
          explanation:
            `Your core is ${Math.round(drift.heldStockShare * 100)}% stocks; your plan calls for ${Math.round(drift.targetStockShare * 100)}%. ` +
            'This sells a little of what grew and buys what lagged to bring you back to plan. Your safety cushion is not touched.',
          change: { label: 'stocks', beforePct: pct(drift.heldStockShare), afterPct: pct(drift.targetStockShare) },
          amountMovedUsd: Math.round(trades.filter(t => t.side === 'sell').reduce((s, t) => s + t.usd, 0)),
          estimatedCostUsd: oneWayCost(trades),
          estimatedTaxUsd: 0,
          taxNote: 'none — practice money, nothing real is sold',
          ...badYear(trades),
          doNothing:
            'If you do nothing, your core stays as it is and carries more (or less) risk than your plan. Nothing happens until you approve.',
          summary: coreRebalanceSummary(trades),
        },
      })
    }

    // ── 3. Explore trailed Core → shrink the Explore limit (roadmap #3) ─────
    const vs = await loadExploreVsCore(ctx.supabase, ctx.userId).catch(() => null)
    if (vs?.verdict.propose && vs.summary && vs.verdict.newCapFraction != null) {
      return NextResponse.json({
        decision: {
          kind: 'explore_shrink',
          title: 'Shrink your Explore limit',
          explanation: `${vs.verdict.reason} When strategies don't beat simply holding your Core funds, the sensible move is to give them less room.`,
          change: { label: 'Explore limit', beforePct: pct(vs.verdict.currentCapFraction), afterPct: pct(vs.verdict.newCapFraction) },
          amountMovedUsd: 0,
          estimatedCostUsd: 0,
          estimatedTaxUsd: 0,
          taxNote: 'none — nothing is sold',
          badYearBeforeUsd: null,
          badYearAfterUsd: null,
          doNothing: 'If you do nothing, Explore keeps its current limit. Nothing happens until you approve.',
          summary: vs.summary,
        },
      })
    }

    // ── 4. Legacy recorded-account rebalance ────────────────────────────────
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

    // Stock share before/after scales the stock part of the tier-mix bad year.
    const stockOnly = yearRangeForMix(
      { cashUsd: 0, stocksUsd: Math.max(1, investable), bondsUsd: 0, otherUsd: 0 }, stockReturns, bondReturns)
    const badYearBeforeUsd = stockOnly && beforeStockPct != null ? Math.round(stockOnly.badYearUsd * (beforeStockPct / 100)) : null
    const badYearAfterUsd = stockOnly && afterStockPct != null ? Math.round(stockOnly.badYearUsd * (afterStockPct / 100)) : null

    return NextResponse.json({
      decision: {
        kind: 'rebalance',
        title: 'Rebalance your accounts',
        explanation:
          'Part of your recorded mix has grown past the share your plan calls for. This sells a little of what grew and buys what lagged to bring you back to plan.',
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
          `Rebalance my accounts: move about ${usd(amountMovedUsd)} back to my plan, ` +
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

  if (body.kind === 'explore_shrink') {
    const res = await approveExploreShrink(ctx.supabase, ctx.userId, summary)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
    return NextResponse.json({ ok: true, kind: 'explore_shrink', capFraction: res.capFraction, executed: 0, skippedOrders: [], errors: [] })
  }

  if (body.kind === 'ladder_setup' || body.kind === 'core_rebalance') {
    const res = body.kind === 'ladder_setup'
      ? await approveLadderSetup(ctx.supabase, ctx.userId, summary)
      : await approveCoreRebalance(ctx.supabase, ctx.userId, summary)
    if (res.error) return NextResponse.json({ error: res.error }, { status: 400 })
    return NextResponse.json({
      ok: res.ok, kind: body.kind,
      safetyUsd: res.safetyUsd, coreUsd: res.coreUsd,
      executed: res.executed, skippedOrders: [], errors: res.failures,
    })
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
