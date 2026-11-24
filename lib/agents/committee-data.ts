/**
 * AI committee cost-and-value data (roadmap #7) — reads with the person's
 * own session (RLS), writes the on/off switch. Turning an agent OFF records
 * an approval first and is allowed only with evidence (verdict cut,
 * never_vetoes or failing) and never for a protected agent. Turning one back
 * ON is always allowed.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { HARDCODED_AGENT_WEIGHTS } from '@/lib/agents/agent-calibration'
import { committeeReport, cutSummary, type CommitteeReport, type GradedRun, type UsageRow } from '@/lib/agents/committee-value'
import { COMMITTEE_REVIEW_LOOKBACK_DAYS, PROTECTED_COMMITTEE_AGENTS } from '@/lib/config/product-defaults'

/** Strategy-pipeline checks graded from the shadow portfolio, and the caller their calls are metered under. */
export const STRATEGY_CHECKS: Record<string, string | null> = {
  Kronos: 'kronos',                     // blocks: "kronos contradicts: …"
  'MiroFish (strategy)': 'mirofish',    // only shrinks size — never blocks
}

/** Which AI check blocked a shadow-tracked trade (the detail holds the engine's reason). */
export function shadowCheckOf(detail: string | null): string | null {
  const r = (detail ?? '').toLowerCase()
  if (r.includes('kronos')) return 'Kronos'
  if (r.includes('mirofish')) return 'MiroFish (strategy)'
  return null
}

export async function loadCommitteeReport(supabase: SupabaseClient, userId: string, now: Date = new Date()): Promise<CommitteeReport & { available: boolean }> {
  const since = new Date(now.getTime() - COMMITTEE_REVIEW_LOOKBACK_DAYS * 86_400_000).toISOString()
  const [runsRes, usageRes, shadowRes, settingsRes] = await Promise.all([
    supabase.from('committee_runs').select('votes, outcome_return, notional_usd, decision')
      .eq('user_id', userId).gte('decided_at', since).limit(10_000),
    supabase.from('llm_usage_log').select('agent_name, caller, cost_usd, ok').gte('created_at', since).limit(50_000),
    supabase.from('shadow_positions').select('skip_reason, skip_detail, realized_pnl_usd')
      .eq('user_id', userId).eq('status', 'closed').gte('closed_at', since).limit(10_000),
    supabase.from('committee_agent_settings').select('agent_name, enabled').eq('user_id', userId),
  ])
  const runs: GradedRun[] = ((runsRes.data ?? []) as Array<{ votes: Record<string, string> | null; outcome_return: number | string | null; notional_usd: number | string | null; decision: string }>)
    .map(r => ({
      votes: r.votes ?? {}, decision: r.decision,
      outcomeReturn: r.outcome_return == null ? null : Number(r.outcome_return),
      notionalUsd: Math.abs(Number(r.notional_usd ?? 0)),
    }))
  const usage: UsageRow[] = ((usageRes.data ?? []) as Array<{ agent_name: string | null; caller: string; cost_usd: number | string | null; ok: boolean }>)
    .map(u => ({ agentName: u.agent_name, caller: u.caller, costUsd: u.cost_usd == null ? null : Number(u.cost_usd), ok: u.ok }))
  const shadowBlocks: Record<string, number[]> = {}
  for (const s of (shadowRes.data ?? []) as Array<{ skip_reason: string | null; skip_detail: string | null; realized_pnl_usd: number | string | null }>) {
    const check = shadowCheckOf(`${s.skip_detail ?? ''} ${s.skip_reason ?? ''}`)
    if (!check || s.realized_pnl_usd == null) continue
    ;(shadowBlocks[check] ??= []).push(Number(s.realized_pnl_usd))
  }
  const report = committeeReport({
    runs, totalRuns: runs.length, usage,
    committeeAgents: Object.keys(HARDCODED_AGENT_WEIGHTS),
    shadowBlocks, strategyCallers: STRATEGY_CHECKS,
    disabled: ((settingsRes.data ?? []) as Array<{ agent_name: string; enabled: boolean }>).filter(s => !s.enabled).map(s => s.agent_name),
  })
  return { ...report, available: !runsRes.error && !usageRes.error }
}

export async function setCommitteeAgentEnabled(
  supabase: SupabaseClient, userId: string, agent: string, enabled: boolean, approvedSummary?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!Object.keys(HARDCODED_AGENT_WEIGHTS).includes(agent)) return { ok: false, error: 'unknown agent' }
  if (!enabled) {
    if (PROTECTED_COMMITTEE_AGENTS.includes(agent)) return { ok: false, error: `${agent} is a safety check and can't be turned off.` }
    const report = await loadCommitteeReport(supabase, userId)
    const row = report.agents.find(a => a.agent === agent)
    if (!row?.canDisable) return { ok: false, error: `There isn't evidence yet that ${agent} should be cut (${row?.reason ?? 'no data'}).` }
    const summary = approvedSummary?.trim() || cutSummary(row)
    const { error: apprErr } = await supabase.from('automation_approvals').insert({
      user_id: userId, kind: 'cut_agent', subject: agent, summary,
      metadata: { verdict: row.verdict, vetoes: row.vetoes, veto_value_usd: row.vetoValueUsd, cost_usd: row.costUsd },
    })
    if (apprErr) return { ok: false, error: `could not record approval: ${apprErr.message}` }
  }
  const { error } = await supabase.from('committee_agent_settings').upsert({
    user_id: userId, agent_name: agent, enabled, reason: enabled ? null : 'cut from the cost report',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,agent_name' })
  return error ? { ok: false, error: error.message } : { ok: true }
}
