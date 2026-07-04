/**
 * W4 — committee agent weight calibration.
 *
 * The CIO committee's per-agent vote weights were hardcoded forever. They are
 * now stored in agent_weights, recalibrated weekly from graded votes (agent
 * audit rows matched to closed paper positions on the same symbol), and read
 * by the engine with the hardcoded map as a fail-open fallback.
 *
 * Calibration math: softmax over per-agent accuracy for agents with enough
 * graded samples, asymmetrically clamped against the current weights —
 * upgrades slow (one good week proves little), downgrades fast (a
 * mis-calibrated agent sheds influence quickly).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// The long-standing committee weights — the FALLBACK, never deleted.
export const HARDCODED_AGENT_WEIGHTS: Record<string, number> = {
  OrchestratorAgent: 0.05,
  ClientProfileAgent: 0.08,
  PortfolioDiagnosticAgent: 0.10,
  FundamentalEquityAgent: 0.10,
  TechnicalMarketAgent: 0.07,
  QuantScreeningAgent: 0.07,
  MacroRegimeAgent: 0.08,
  CryptoIntelligenceAgent: 0.05,
  ForexStrategyAgent: 0.05,
  RiskManagementAgent: 0.12,
  TaxOptimizationAgent: 0.05,
  RetirementExecutionAgent: 0.05,
  MiroFishSimulationAgent: 0.13,
}

export const MIN_AGENT_SAMPLES = 10
export const AGENT_MAX_INCREASE = 0.05   // per weekly cycle
export const AGENT_MAX_DECREASE = 0.15   // asymmetric: shed influence fast
const SOFTMAX_TEMPERATURE = 0.15

export interface AgentAccuracy {
  accuracy: number   // 0..1
  samples: number
}

/**
 * Softmax over accuracy for evidenced agents, redistributing ONLY the budget
 * those agents already hold; unevidenced agents keep their current weight.
 * Per-agent change is clamped asymmetrically. Result renormalized to sum 1.
 */
export function calibrateWeights(
  current: Record<string, number>,
  graded: Record<string, AgentAccuracy>,
  temperature = SOFTMAX_TEMPERATURE
): Record<string, number> {
  const keys = Object.keys(current)
  const evidenced = keys.filter(k => (graded[k]?.samples ?? 0) >= MIN_AGENT_SAMPLES)

  const target: Record<string, number> = { ...current }
  if (evidenced.length >= 2) {
    const exps = evidenced.map(k => Math.exp(graded[k].accuracy / temperature))
    const sumExp = exps.reduce((s, e) => s + e, 0)
    const budget = evidenced.reduce((s, k) => s + current[k], 0)
    evidenced.forEach((k, i) => { target[k] = budget * (exps[i] / sumExp) })
  }

  const out: Record<string, number> = {}
  for (const k of keys) {
    const delta = Math.max(-AGENT_MAX_DECREASE, Math.min(AGENT_MAX_INCREASE, target[k] - current[k]))
    out[k] = Math.max(0.01, current[k] + delta)
  }
  const total = Object.values(out).reduce((s, v) => s + v, 0)
  for (const k of keys) out[k] = Math.round((out[k] / total) * 10_000) / 10_000
  return out
}

/**
 * Read the calibrated weights; fall back to the hardcoded map on any failure
 * or empty table. Unknown agents always get their hardcoded weight.
 */
export async function loadAgentWeights(supabase?: SupabaseClient): Promise<Record<string, number>> {
  if (!supabase) return { ...HARDCODED_AGENT_WEIGHTS }
  try {
    const { data, error } = await supabase
      .from('agent_weights')
      .select('agent_name, weight')
    if (error || !data || data.length === 0) return { ...HARDCODED_AGENT_WEIGHTS }
    const out = { ...HARDCODED_AGENT_WEIGHTS }
    for (const row of data as Array<{ agent_name: string; weight: number }>) {
      if (row.agent_name in out && Number.isFinite(row.weight) && row.weight > 0) {
        out[row.agent_name] = row.weight
      }
    }
    return out
  } catch {
    return { ...HARDCODED_AGENT_WEIGHTS }
  }
}

/**
 * Weighted committee mean. 'defer' votes are ABSTENTIONS (agent error,
 * unparseable output, not-applicable) and are excluded — they must never
 * drag the committee toward neutral-50. All-defer → neutral 50.
 */
export function computeCommitteeScore(
  outputs: Array<{ agent: string; score: number; recommendation: string }>,
  weights: Record<string, number>
): number {
  let weightedScore = 0
  let totalWeight = 0
  for (const output of outputs) {
    if (output.recommendation === 'defer') continue
    const w = weights[output.agent] ?? 0.05
    weightedScore += output.score * w
    totalWeight += w
  }
  return totalWeight > 0 ? weightedScore / totalWeight : 50
}

/**
 * Weekly calibration pass. Grades each committee vote (audit_logs rows with
 * agent_name + output) against the closed paper position on the same symbol
 * opened within 48h of the vote:
 *   approve/reduce → correct when the position made money
 *   reject         → correct when the position lost money
 *   defer          → abstention, never graded
 * Upserts agent_weights; returns what changed.
 */
export async function runAgentCalibration(supabase: SupabaseClient): Promise<{
  graded: Record<string, AgentAccuracy>
  weights: Record<string, number>
  updated: boolean
}> {
  const current = await loadAgentWeights(supabase)

  const since = new Date(Date.now() - 90 * 86_400_000).toISOString()
  const [{ data: votes }, { data: positions }] = await Promise.all([
    supabase
      .from('audit_logs')
      .select('agent_name, trade_context, output, created_at')
      .not('agent_name', 'is', null)
      .gte('created_at', since)
      .limit(5000),
    supabase
      .from('paper_positions')
      .select('symbol, opened_at, realized_pnl_usd')
      .eq('status', 'closed')
      .gte('opened_at', since)
      .limit(5000),
  ])

  const posBySymbol = new Map<string, Array<{ openedAt: number; pnl: number }>>()
  for (const p of (positions ?? []) as Array<{ symbol: string; opened_at: string; realized_pnl_usd: number | null }>) {
    if (p.realized_pnl_usd == null) continue
    const list = posBySymbol.get(p.symbol) ?? []
    list.push({ openedAt: new Date(p.opened_at).getTime(), pnl: p.realized_pnl_usd })
    posBySymbol.set(p.symbol, list)
  }

  const tally: Record<string, { hits: number; n: number }> = {}
  for (const v of (votes ?? []) as Array<{
    agent_name: string
    trade_context: { symbol?: string } | null
    output: { recommendation?: string } | null
    created_at: string
  }>) {
    const rec = v.output?.recommendation
    if (!rec || rec === 'defer') continue   // abstentions are never graded
    const symbol = v.trade_context?.symbol
    if (!symbol) continue
    const votedAt = new Date(v.created_at).getTime()
    const match = (posBySymbol.get(symbol) ?? []).find(
      p => p.openedAt >= votedAt && p.openedAt <= votedAt + 48 * 3_600_000
    )
    if (!match) continue

    const won = match.pnl > 0
    const correct = (rec === 'approve' || rec === 'reduce') ? won : !won
    const bucket = (tally[v.agent_name] ??= { hits: 0, n: 0 })
    bucket.n += 1
    if (correct) bucket.hits += 1
  }

  const graded: Record<string, AgentAccuracy> = {}
  for (const [agent, t] of Object.entries(tally)) {
    graded[agent] = { accuracy: t.n > 0 ? t.hits / t.n : 0, samples: t.n }
  }

  const weights = calibrateWeights(current, graded)

  let updated = false
  try {
    const rows = Object.entries(weights).map(([agent_name, weight]) => ({
      agent_name,
      weight,
      samples: graded[agent_name]?.samples ?? 0,
      accuracy: graded[agent_name]?.accuracy ?? null,
      updated_at: new Date().toISOString(),
    }))
    const { error } = await supabase.from('agent_weights').upsert(rows, { onConflict: 'agent_name' })
    updated = !error
  } catch { /* fall back silently — engine reads hardcoded weights */ }

  return { graded, weights, updated }
}
