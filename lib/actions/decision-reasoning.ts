'use server'

/**
 * Agent reasoning transparency (UI brief widget 2) — for each recent decision
 * in audit_logs, the verdicts of the pipeline committee that actually ran:
 * Red Team (adversarial score), MiroFish (simulation), Kronos (directional
 * confluence), and the risk/kill-switch/cost gates. Doubles as the audit trail.
 */

import { createClient } from '@/lib/supabase/server'

export interface DecisionReasoningRow {
  id: string
  at: string
  strategyKey: string
  symbol: string
  decision: string
  sizeFraction: number | null
  redTeamScore: number | null
  miroFishScore: number | null
  miroFishUsed: boolean
  kronosPass: boolean | null
  kronosUsed: boolean
  blockedBy: string | null
  reason: string | null
  direction: string | null
}

interface AuditRow {
  id: string
  decided_at: string
  strategy_key: string
  symbol: string
  decision: string
  size_fraction: number | null
  red_team_score: number | null
  mirofish_score: number | null
  mirofish_used: boolean | null
  kronos_pass: boolean | null
  kronos_used: boolean | null
  metadata: Record<string, unknown> | null
}

export async function getDecisionReasoning(limit = 25): Promise<DecisionReasoningRow[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('audit_logs')
    .select('id, decided_at, strategy_key, symbol, decision, size_fraction, red_team_score, mirofish_score, mirofish_used, kronos_pass, kronos_used, metadata')
    .eq('user_id', user.id)
    .order('decided_at', { ascending: false })
    .limit(limit)

  return ((data ?? []) as AuditRow[]).map(r => ({
    id: r.id,
    at: r.decided_at,
    strategyKey: r.strategy_key,
    symbol: r.symbol,
    decision: r.decision,
    sizeFraction: r.size_fraction,
    redTeamScore: r.red_team_score,
    miroFishScore: r.mirofish_score,
    miroFishUsed: r.mirofish_used ?? false,
    kronosPass: r.kronos_pass,
    kronosUsed: r.kronos_used ?? false,
    blockedBy: (r.metadata?.blocked_by as string | undefined) ?? null,
    reason: (r.metadata?.reason as string | undefined)
      ?? (r.metadata?.reasoning as string | undefined) ?? null,
    direction: (r.metadata?.direction as string | undefined) ?? null,
  }))
}
