/**
 * Rolling Brier score computation for adaptive position sizing (T4.1).
 *
 * Fetches the last N days of graded outcomes for a strategy and returns
 * a sizing multiplier:
 *   brierScore > 0.25  → poorly calibrated → 0.5× size
 *   brierScore < 0.18  → well calibrated   → 1.25× size
 *   otherwise          → neutral            → 1.0×
 *
 * Returns null when insufficient data (< 10 samples).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface RollingBrierResult {
  strategyKey: string
  windowDays: number
  brierScore: number
  sampleCount: number
  sizingMultiplier: number
}

const MIN_SAMPLES = 10

export async function getRollingBrier(
  supabase: SupabaseClient,
  strategyKey: string,
  windowDays = 30
): Promise<RollingBrierResult | null> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString()

  // Join decision_records with outcome_records via decision_id
  const { data, error } = await (supabase as unknown as {
    from: (t: string) => {
      select: (s: string) => {
        eq: (a: string, b: unknown) => {
          gte: (a: string, b: string) => Promise<{ data: unknown[] | null; error: unknown }>
        }
      }
    }
  })
    .from('outcome_records')
    .select('brier_score, decision:decision_records!inner(strategy, created_at)')
    .eq('decision.strategy', strategyKey)
    .gte('decision.created_at', since)

  if (error || !data || data.length < MIN_SAMPLES) return null

  const brierScores = (data as Array<{ brier_score: number }>)
    .map(r => r.brier_score)
    .filter((b): b is number => typeof b === 'number')

  if (brierScores.length < MIN_SAMPLES) return null

  const brierScore = brierScores.reduce((s, b) => s + b, 0) / brierScores.length

  const sizingMultiplier =
    brierScore > 0.25 ? 0.5
    : brierScore < 0.18 ? 1.25
    : 1.0

  return {
    strategyKey,
    windowDays,
    brierScore,
    sampleCount: brierScores.length,
    sizingMultiplier,
  }
}
