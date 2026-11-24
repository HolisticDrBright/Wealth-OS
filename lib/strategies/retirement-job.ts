/**
 * Weekly automatic-retirement review (roadmap #4) — the `lifecycle` cron task
 * (Mondays, via daily-ops). Service-role client; every write is scoped to the
 * person × strategy it judges.
 *
 * For each paper-ENABLED strategy of each person:
 *   1. record this week's gate snapshot (strategy_gate_snapshots),
 *   2. apply the rules in lib/strategies/retirement.ts,
 *   3. when one fires: paper_enabled = false, a retirement-log row, and an
 *      alert the person can read. Never a maturity change; never more trading.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { LADDER_KEYS_FILTER } from '@/lib/allocation/sleeves'
import { quarterOf } from '@/lib/strategies/lifecycle'
import { STRATEGY_REGISTRY_CONFIG, type StrategyKey } from '@/lib/strategies/strategy-registry'
import { toDisplayName } from '@/lib/strategies/strategy-display'
import { retirementVerdict, weeklyGateSnapshot, type RetireRule } from '@/lib/strategies/retirement'
import type { ClosedTradeRow } from '@/lib/strategies/track-record'
import { sendOpsAlert } from '@/lib/ops/alert'

export type Benchmarks = { spy: Map<string, number>; btc: Map<string, number>; fx: Map<string, number> }

/** Quarterly % returns for a Yahoo symbol over 2 years ({} on failure). */
export async function quarterlyReturns(symbol: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=3mo&range=2y`,
      { signal: AbortSignal.timeout(8_000) })
    if (res.ok) {
      const d = await res.json() as { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } }
      const r = d.chart?.result?.[0]
      const ts = r?.timestamp ?? []
      const closes = r?.indicators?.quote?.[0]?.close ?? []
      for (let i = 1; i < ts.length; i++) {
        const a = closes[i - 1]; const b = closes[i]
        if (a && b) out.set(quarterOf(new Date(ts[i] * 1000).toISOString()), (b / a - 1) * 100)
      }
    }
  } catch { /* missing feed → that asset class sees no benchmark demotions this run */ }
  return out
}

export async function fetchBenchmarks(): Promise<Benchmarks> {
  const [spy, btc, fx] = await Promise.all([quarterlyReturns('SPY'), quarterlyReturns('BTC-USD'), quarterlyReturns('UUP')])
  return { spy, btc, fx }
}

/** The passive benchmark for an asset class — never one we didn't measure. */
export function benchFor(assetClass: string, b: Benchmarks): Map<string, number> | 'hold_no' | null {
  switch (assetClass) {
    case 'stocks': case 'stock': case 'options': case 'etf': case 'multi-asset':
      return b.spy.size ? b.spy : null
    case 'crypto':
      return b.btc.size ? b.btc : null
    case 'forex': case 'fx':
      return b.fx.size ? b.fx : null
    case 'polymarket': case 'prediction_market':
      return 'hold_no'   // a fair binary market has zero expected return
    default:
      return null
  }
}

export interface RetirementRun {
  reviewed: number
  retired: Array<{ userId: string; strategyKey: string; rule: RetireRule }>
  snapshots: number
}

type TradeRow = ClosedTradeRow & { user_id: string; asset_class: string }

export async function runRetirementReview(
  admin: SupabaseClient,
  opts: { now?: Date; benchmarks?: Benchmarks } = {},
): Promise<RetirementRun> {
  const now = opts.now ?? new Date()
  const benchmarks = opts.benchmarks ?? await fetchBenchmarks()

  const [enabledRes, tradesRes, retiredRes, snapsRes] = await Promise.all([
    admin.from('user_enabled_strategies').select('user_id, strategy_key, created_at').eq('paper_enabled', true),
    admin.from('paper_positions')
      .select('user_id, strategy_key, asset_class, realized_pnl_pct, realized_pnl_usd, notional_usd, opened_at, closed_at')
      .not('strategy_key', 'in', LADDER_KEYS_FILTER)
      .eq('status', 'closed').order('closed_at', { ascending: false }).limit(50_000),
    admin.from('strategy_retirement_log').select('user_id, strategy_key, created_at'),
    admin.from('strategy_gate_snapshots').select('user_id, strategy_key, week, failing'),
  ])

  const k = (u: string, s: string) => `${u}|${s}`
  const lastRetired = new Map<string, string>()
  for (const r of (retiredRes.data ?? []) as Array<{ user_id: string; strategy_key: string; created_at: string }>) {
    const key = k(r.user_id, r.strategy_key)
    if (!lastRetired.has(key) || r.created_at > lastRetired.get(key)!) lastRetired.set(key, r.created_at)
  }
  const tradesBy = new Map<string, TradeRow[]>()
  for (const t of (tradesRes.data ?? []) as TradeRow[]) {
    const key = k(t.user_id, t.strategy_key)
    if (!tradesBy.has(key)) tradesBy.set(key, [])
    tradesBy.get(key)!.push(t)
  }
  const snapsBy = new Map<string, Array<{ week: string; failing: boolean | null }>>()
  for (const s of (snapsRes.data ?? []) as Array<{ user_id: string; strategy_key: string; week: string; failing: boolean | null }>) {
    const key = k(s.user_id, s.strategy_key)
    if (!snapsBy.has(key)) snapsBy.set(key, [])
    snapsBy.get(key)!.push({ week: String(s.week).slice(0, 10), failing: s.failing })
  }

  const out: RetirementRun = { reviewed: 0, retired: [], snapshots: 0 }
  for (const e of (enabledRes.data ?? []) as Array<{ user_id: string; strategy_key: string; created_at: string | null }>) {
    const key = k(e.user_id, e.strategy_key)
    const since = lastRetired.get(key) ?? null
    const cfgClass = STRATEGY_REGISTRY_CONFIG[e.strategy_key as StrategyKey]?.assetClass
    const trades = (tradesBy.get(key) ?? []).filter(t => !since || (t.closed_at ?? '') > since)
    const assetClass = cfgClass ?? trades[0]?.asset_class ?? 'multi-asset'
    const windowStart = [e.created_at, since].filter((x): x is string => !!x).sort().pop() ?? null
    const input = {
      strategyKey: e.strategy_key, assetClass, trades,
      benchmark: benchFor(assetClass, benchmarks),
      priorSnapshots: (snapsBy.get(key) ?? []).filter(s => !since || s.week > since.slice(0, 10)),
      windowStart, now,
    }
    const snap = weeklyGateSnapshot(input)
    out.reviewed++
    const { error: snapErr } = await admin.from('strategy_gate_snapshots').upsert({
      user_id: e.user_id, strategy_key: e.strategy_key, week: snap.week, closed_trades: snap.closedTrades,
      net_expectancy_pct: snap.netExpectancyPct, max_drawdown_pct: snap.maxDrawdownPct, failing: snap.failing,
    }, { onConflict: 'user_id,strategy_key,week' })
    if (!snapErr) out.snapshots++

    const v = retirementVerdict(input, snap)
    if (!v.retire || !v.rule) continue

    const { error: offErr } = await admin.from('user_enabled_strategies')
      .update({ paper_enabled: false }).eq('user_id', e.user_id).eq('strategy_key', e.strategy_key)
    if (offErr) { console.warn('[retirement] switch-off failed:', offErr.message); continue }
    out.retired.push({ userId: e.user_id, strategyKey: e.strategy_key, rule: v.rule })
    await admin.from('strategy_retirement_log').insert({
      user_id: e.user_id, strategy_key: e.strategy_key, rule: v.rule, reason: v.reason,
      metrics: { closed_trades: snap.closedTrades, net_expectancy_pct: snap.netExpectancyPct, max_drawdown_pct: snap.maxDrawdownPct, streak_weeks: v.streakWeeks },
      created_at: now.toISOString(),
    }).then(({ error }) => { if (error) console.warn('[retirement] log failed:', error.message) })
    await sendOpsAlert(admin, {
      severity: 'warning', userId: e.user_id,
      title: `Switched off: ${toDisplayName(e.strategy_key)}`,
      message: `${v.reason} Its practice trading stops; it keeps being tracked, and you can turn it back on.`,
      actionUrl: '/strategies/readiness',
    })
  }
  return out
}
