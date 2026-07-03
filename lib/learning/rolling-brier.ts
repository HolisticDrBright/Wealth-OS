/**
 * Rolling Brier score computation for adaptive position sizing (T4.1).
 *
 * Uses a TRADE-COUNT window (last N graded outcomes) rather than a calendar
 * window: a strategy that trades 3×/month would only ever have ~3 samples in
 * a 30-day window, making the estimate pure noise. The last-20-outcomes window
 * gives every strategy the same statistical footing regardless of frequency.
 * A calendar lookback cap (180 days) still applies so ancient outcomes from a
 * since-changed market can't dominate.
 *
 * Sizing multiplier:
 *   brierScore > 0.25  → poorly calibrated → 0.5× size
 *   brierScore < 0.18  → well calibrated   → 1.25× size
 *   otherwise          → neutral            → 1.0×
 *
 * Returns null when insufficient data (< 10 samples).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface RollingBrierResult {
  strategyKey: string
  /** Number of most-recent graded outcomes the score was computed over. */
  windowTrades: number
  /** @deprecated retained for old callers; mirrors the calendar cap. */
  windowDays: number
  brierScore: number
  sampleCount: number
  sizingMultiplier: number
  /**
   * Empirical win rate over the window [0,1] — the calibrated win-probability
   * input for Kelly sizing (never use signal strength as a probability).
   * Null when outcome directions aren't recorded.
   */
  winRate: number | null
}

const MIN_SAMPLES = 10
const WINDOW_TRADES = 20
const MAX_LOOKBACK_DAYS = 180

export async function getRollingBrier(
  supabase: SupabaseClient,
  strategyKey: string,
  windowTrades = WINDOW_TRADES
): Promise<RollingBrierResult | null> {
  const since = new Date(Date.now() - MAX_LOOKBACK_DAYS * 86_400_000).toISOString()

  // Join decision_log with outcome_log via decision_id; newest first so the
  // limit keeps the most recent outcomes.
  const { data, error } = await (supabase as unknown as {
    from: (t: string) => {
      select: (s: string) => {
        eq: (a: string, b: unknown) => {
          gte: (a: string, b: string) => {
            order: (c: string, o: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }>
            }
          }
        }
      }
    }
  })
    .from('outcome_log')
    .select('brier_score, actual_direction, created_at, decision:decision_log!inner(strategy, created_at)')
    .eq('decision.strategy', strategyKey)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(windowTrades)

  if (error || !data || data.length < MIN_SAMPLES) return null

  const rows = data as Array<{ brier_score: number; actual_direction?: number | null }>
  const brierScores = rows
    .map(r => r.brier_score)
    .filter((b): b is number => typeof b === 'number')

  if (brierScores.length < MIN_SAMPLES) return null

  const brierScore = brierScores.reduce((s, b) => s + b, 0) / brierScores.length

  const directions = rows
    .map(r => r.actual_direction)
    .filter((d): d is number => d === 0 || d === 1)
  const winRate = directions.length >= MIN_SAMPLES
    ? directions.reduce((s, d) => s + d, 0) / directions.length
    : null

  const sizingMultiplier =
    brierScore > 0.25 ? 0.5
    : brierScore < 0.18 ? 1.25
    : 1.0

  return {
    strategyKey,
    windowTrades: brierScores.length,
    windowDays: MAX_LOOKBACK_DAYS,
    brierScore,
    sampleCount: brierScores.length,
    sizingMultiplier,
    winRate,
  }
}
