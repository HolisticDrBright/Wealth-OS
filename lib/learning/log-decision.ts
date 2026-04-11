/**
 * Log a prediction decision to decision_log.
 * Call this from any API route that produces a signal (predict, opportunities, etc.)
 * Returns the decision ID so it can be referenced when grading outcomes.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import type { LearningStrategy } from './types'

export interface DecisionInput {
  user_id: string
  strategy: LearningStrategy | string
  symbol: string
  /** Probability that price goes UP [0, 1] */
  confidence: number
  /** 1 = predicted up, 0 = predicted down */
  predicted_direction: 0 | 1
  predicted_return?: number
  horizon_days?: number
  signal_weights?: Record<string, number>
  metadata?: Record<string, unknown>
}

export async function logDecision(input: DecisionInput): Promise<string | null> {
  try {
    const horizonDays = input.horizon_days ?? 7
    const resolutionDue = new Date(Date.now() + horizonDays * 86_400_000).toISOString()
    const admin = createAdminClient()

    const { data } = await admin
      .from('decision_log')
      .insert({
        user_id: input.user_id,
        strategy: input.strategy,
        symbol: input.symbol,
        confidence: input.confidence,
        predicted_direction: input.predicted_direction,
        predicted_return: input.predicted_return ?? null,
        signal_weights: input.signal_weights ?? null,
        horizon_days: horizonDays,
        resolution_due_at: resolutionDue,
        outcome_graded: false,
        metadata: input.metadata ?? null,
      })
      .select('id')
      .single()

    return data?.id ?? null
  } catch {
    // Never let logging failures affect the caller
    return null
  }
}
