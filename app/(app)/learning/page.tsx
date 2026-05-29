import { createClient } from '@/lib/supabase/server'
import { loadWeightsForUser } from '@/lib/learning/weights'
import { scoreStrategies } from '@/lib/learning/scorer'
import { getAgentTrust } from '@/lib/actions/agent-trust'
import { LearningClient } from './learning-client'

export default async function LearningPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [weights, { data: outcomes }, { count: totalDecisions }, { count: pendingCount }, agents] = await Promise.all([
    loadWeightsForUser(user.id),
    supabase
      .from('outcome_log')
      .select('actual_direction, actual_return, alpha_vs_benchmark, decision:decision_log(strategy, confidence)')
      .eq('user_id', user.id)
      .order('resolved_at', { ascending: false })
      .limit(500),
    supabase
      .from('decision_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
    supabase
      .from('decision_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('outcome_graded', false),
    getAgentTrust(),
  ])

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

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Learning Loop</h1>
        <p className="text-sm text-gray-500 mt-1">
          Self-tuning strategy weights based on Brier score + hit rate + alpha
        </p>
      </div>
      <LearningClient
        initialWeights={weights}
        initialStats={stats}
        totalDecisions={totalDecisions ?? 0}
        totalOutcomes={outcomes?.length ?? 0}
        pendingGrade={pendingCount ?? 0}
        agents={agents}
      />
    </div>
  )
}
