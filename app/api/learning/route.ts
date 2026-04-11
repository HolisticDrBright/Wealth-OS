/**
 * GET  /api/learning  — current strategy weights + performance stats
 * POST /api/learning  — trigger a learning pass (grade outcomes + update weights)
 */
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiSuccess, apiError } from '@/lib/api'
import { runLearningPass } from '@/lib/learning/loop'
import { loadWeightsForUser } from '@/lib/learning/weights'
import { scoreStrategies } from '@/lib/learning/scorer'

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const [weights, { data: outcomes }] = await Promise.all([
    loadWeightsForUser(user.id),
    supabase
      .from('outcome_log')
      .select('actual_direction, actual_return, alpha_vs_benchmark, brier_score, decision:decision_log(strategy, confidence)')
      .eq('user_id', user.id)
      .order('resolved_at', { ascending: false })
      .limit(500),
  ])

  // Per-strategy performance stats
  const rows = (outcomes ?? [])
    .filter((o): o is typeof o & { decision: { strategy: string; confidence: number } } => o.decision != null)
    .map(o => ({
      strategy: o.decision.strategy,
      confidence: o.decision.confidence,
      actual_direction: o.actual_direction as number,
      actual_return: o.actual_return as number,
      alpha_vs_benchmark: o.alpha_vs_benchmark as number,
    }))

  const scores = scoreStrategies(rows)

  const stats = scores.map(s => ({
    ...s,
    current_weight: weights[s.strategy] ?? null,
  }))

  // Count pending (ungraded) decisions
  const { count: pendingCount } = await supabase
    .from('decision_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('outcome_graded', false)

  // Total decisions logged
  const { count: totalDecisions } = await supabase
    .from('decision_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  return apiSuccess({
    weights,
    stats,
    total_decisions: totalDecisions ?? 0,
    total_outcomes: outcomes?.length ?? 0,
    pending_grade: pendingCount ?? 0,
  })
}

export async function POST(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const result = await runLearningPass(user.id)
  return apiSuccess(result)
}
