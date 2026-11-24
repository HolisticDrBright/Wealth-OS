/**
 * Committee runs (roadmap #7) — record every copy-trade committee decision
 * with each agent's vote and the price at the time, then grade it
 * COMMITTEE_GRADE_HORIZON_DAYS later on what the trade would have done.
 *
 * A vetoed copy never becomes a position, so before this a veto could never
 * be graded at all. Grading it against the price move is what lets the cost
 * report say whether an agent's "no" saves money or costs it.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TradeContext, CIODecision } from '@/lib/agents/types'
import { roundTripCostBps } from '@/lib/costs/transaction-costs'
import { toRiskClass } from '@/lib/risk/risk-units'
import { COMMITTEE_GRADE_HORIZON_DAYS, PROTECTED_COMMITTEE_AGENTS } from '@/lib/config/product-defaults'
import type { DailyPoint } from '@/lib/explore/vs-core'

const DAY = 86_400_000

async function admin(): Promise<SupabaseClient | null> {
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    return createAdminClient()
  } catch { return null }
}

/** Agents this person turned off ([] when none or unreadable). */
export async function loadDisabledAgents(userId: string, client?: SupabaseClient | null): Promise<string[]> {
  const sb = client ?? await admin()
  if (!sb) return []
  const { data, error } = await sb.from('committee_agent_settings')
    .select('agent_name').eq('user_id', userId).eq('enabled', false)
  if (error) return []
  // Seatbelt: a protected agent (its "no" is a safety rule) is never skipped,
  // whatever the settings table says.
  return ((data ?? []) as Array<{ agent_name: string }>).map(r => r.agent_name)
    .filter(a => !PROTECTED_COMMITTEE_AGENTS.includes(a))
}

/** +1 for a buy/cover (long exposure), −1 for a sell/short. */
export function directionOf(action: string): 1 | -1 {
  return action === 'sell' || action === 'short' ? -1 : 1
}

/** Record one committee decision (fire-and-forget from the engine). */
export async function recordCommitteeRun(context: TradeContext, decision: CIODecision): Promise<void> {
  const sb = await admin()
  if (!sb || !context.runId) return
  let entryPrice: number | null = null
  try {
    const { fetchCurrentPrice } = await import('@/lib/paper-trading/price-feed')
    const cls = toRiskClass(context.trade.asset_class)
    entryPrice = await fetchCurrentPrice(context.trade.symbol, (cls === 'polymarket' ? 'polymarket' : cls) as never)
  } catch { /* ungradable without a price */ }
  const votes: Record<string, string> = {}
  for (const o of decision.agentOutputs) votes[o.agent] = o.metadata?.disabled ? 'disabled' : o.recommendation
  const { error } = await sb.from('committee_runs').insert({
    id: context.runId, user_id: context.user.id,
    symbol: context.trade.symbol, asset_class: context.trade.asset_class, action: context.trade.action,
    notional_usd: context.trade.notional_value, decision: decision.decision,
    votes, scores: decision.agentScores, entry_price: entryPrice, decided_at: new Date().toISOString(),
  })
  if (error) console.warn('[committee-runs] record failed:', error.message)
}

/** Close on or before `date` (ascending series). */
function closeOnOrBefore(series: DailyPoint[], date: string): number | null {
  let ans: number | null = null
  for (const p of series) { if (p.date <= date) ans = p.close; else break }
  return ans
}

/**
 * PURE: the trade's after-cost return over the horizon, in its own direction.
 * null when there is no entry price or no close that far.
 */
export function gradeOutcome(args: {
  series: DailyPoint[]
  entryPrice: number | null
  decidedAt: string
  action: string
  assetClass: string
  horizonDays?: number
}): { returnPct: number; exitPrice: number } | null {
  const { series, entryPrice, decidedAt } = args
  if (!(entryPrice && entryPrice > 0) || series.length === 0) return null
  const target = new Date(new Date(decidedAt).getTime() + (args.horizonDays ?? COMMITTEE_GRADE_HORIZON_DAYS) * DAY).toISOString().slice(0, 10)
  if (series[series.length - 1].date < target) return null            // horizon not reached in the data
  const exit = closeOnOrBefore(series, target)
  if (exit == null) return null
  const cost = roundTripCostBps(toRiskClass(args.assetClass)) / 10_000
  return { returnPct: directionOf(args.action) * (exit / entryPrice - 1) - cost, exitPrice: exit }
}

/** Grade committee runs past their horizon (daily cron, service role). */
export async function gradeCommitteeRuns(sb: SupabaseClient, now: Date = new Date()): Promise<{ graded: number; ungradable: number }> {
  const cutoff = new Date(now.getTime() - COMMITTEE_GRADE_HORIZON_DAYS * DAY).toISOString()
  const { data } = await sb.from('committee_runs')
    .select('id, symbol, asset_class, action, entry_price, decided_at')
    .is('graded_at', null).lte('decided_at', cutoff).limit(200)
  const rows = (data ?? []) as Array<{ id: string; symbol: string; asset_class: string; action: string; entry_price: number | null; decided_at: string }>
  const { fetchDailySeries } = await import('@/lib/explore/vs-core-data')
  const { historySymbol } = await import('@/lib/risk/risk-units')
  let graded = 0, ungradable = 0
  for (const r of rows) {
    const ySym = historySymbol(r.symbol, toRiskClass(r.asset_class))
    const days = Math.ceil((now.getTime() - new Date(r.decided_at).getTime()) / DAY) + 10
    const series = ySym ? await fetchDailySeries(ySym, days) : []
    const g = gradeOutcome({ series, entryPrice: r.entry_price, decidedAt: r.decided_at, action: r.action, assetClass: r.asset_class })
    const tooOld = now.getTime() - new Date(r.decided_at).getTime() > 3 * COMMITTEE_GRADE_HORIZON_DAYS * DAY
    if (!g && !tooOld) continue                                         // try again tomorrow
    await sb.from('committee_runs').update(g
      ? { outcome_return: g.returnPct, exit_price: g.exitPrice, graded_at: now.toISOString() }
      : { outcome_return: null, graded_at: now.toISOString(), ungradable: true }).eq('id', r.id)
    if (g) graded++; else ungradable++
  }
  return { graded, ungradable }
}
