'use server'

/**
 * Calibration reliability data (UI brief widget 7):
 *  - Reliability diagram: predicted confidence buckets vs realized win rate
 *    from graded decision_log rows (perfect calibration = the diagonal).
 *  - Sizer inputs per strategy: the EXACT rolling win probability and Brier
 *    the empirical-Kelly sizer uses (lib/learning/rolling-brier.ts).
 */

import { createClient } from '@/lib/supabase/server'
import { getRollingBrier } from '@/lib/learning/rolling-brier'

export interface ReliabilityBucket {
  /** Bucket midpoint, e.g. 0.55 for [0.5, 0.6). */
  predicted: number
  realized: number
  count: number
}

export interface SizerInputRow {
  strategyKey: string
  winRate: number | null
  brierScore: number
  sampleCount: number
}

export interface CalibrationReliabilityView {
  buckets: ReliabilityBucket[]
  gradedDecisions: number
  sizerInputs: SizerInputRow[]
}

interface DecisionRow {
  strategy: string
  confidence: number
  predicted_direction: number
  outcome: Array<{ actual_direction: number | null }> | null
}

const BUCKET_WIDTH = 0.1

export async function getCalibrationReliability(): Promise<CalibrationReliabilityView | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('decision_log')
    .select('strategy, confidence, predicted_direction, outcome:outcome_log(actual_direction)')
    .eq('user_id', user.id)
    .eq('outcome_graded', true)
    .limit(2000)

  const rows = (data ?? []) as unknown as DecisionRow[]
  const graded = rows
    .map(r => ({
      strategy: r.strategy,
      confidence: r.confidence,
      // "Correct" = the predicted direction matched the realized one.
      correct: r.outcome?.[0]?.actual_direction != null
        ? (r.outcome[0].actual_direction === r.predicted_direction ? 1 : 0)
        : null,
    }))
    .filter((r): r is { strategy: string; confidence: number; correct: number } => r.correct !== null)

  // Bucket by predicted confidence
  const acc = new Map<number, { sum: number; n: number }>()
  for (const g of graded) {
    const bucket = Math.min(0.95, Math.floor(g.confidence / BUCKET_WIDTH) * BUCKET_WIDTH + BUCKET_WIDTH / 2)
    const key = Math.round(bucket * 100) / 100
    const cur = acc.get(key) ?? { sum: 0, n: 0 }
    cur.sum += g.correct
    cur.n += 1
    acc.set(key, cur)
  }
  const buckets = [...acc.entries()]
    .map(([predicted, { sum, n }]) => ({
      predicted,
      realized: Math.round((sum / n) * 100) / 100,
      count: n,
    }))
    .sort((a, b) => a.predicted - b.predicted)

  // Sizer inputs for strategies with graded history
  const strategies = [...new Set(graded.map(g => g.strategy))].slice(0, 30)
  const sizerInputs: SizerInputRow[] = []
  for (const key of strategies) {
    const rb = await getRollingBrier(supabase, key).catch(() => null)
    if (rb) {
      sizerInputs.push({
        strategyKey: key,
        winRate: rb.winRate,
        brierScore: Math.round(rb.brierScore * 1000) / 1000,
        sampleCount: rb.sampleCount,
      })
    }
  }
  sizerInputs.sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))

  return { buckets, gradedDecisions: graded.length, sizerInputs }
}
