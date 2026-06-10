/**
 * Strategy scoring formula for the Wealth OS Learning Loop.
 *
 * Adapted from Brier scoring for wealth management:
 *   - Calibration (Brier score): Is the probability estimate accurate?
 *   - Accuracy (hit rate): Does it predict direction correctly?
 *   - Alpha: Does it add value vs the benchmark (SPY)?
 *   - Return: What's the absolute average return?
 *
 * Calibration dominates because a well-calibrated model sizes correctly
 * across all market regimes, while hit-rate-only models overfit.
 */
import { MIN_SAMPLES } from './weights'
import { roundTripCostBps } from '@/lib/costs/transaction-costs'

export interface ScoringRow {
  strategy: string
  confidence: number        // predicted prob of going up [0, 1]
  actual_direction: number  // 0 or 1
  actual_return: number     // actual % return over horizon (gross of costs)
  alpha_vs_benchmark: number
  /** Asset class for cost netting. Omitted → no cost adjustment (legacy rows). */
  assetClass?: string
}

export interface StrategyScore {
  strategy: string
  count: number
  brier: number       // mean Brier score (lower = better)
  hit_rate: number    // fraction of correct direction calls
  avg_return: number
  avg_alpha: number
  score: number       // composite score (higher = better)
}

/**
 * Wealth OS scoring formula (composite):
 *
 *   calibration: (0.25 - brier) × 3.0    dominant — penalises overconfidence
 *   direction:   (hit_rate - 0.5) × 2.0  accuracy vs random coin flip
 *   alpha:       clip(avg_alpha / 0.03) × 2.0   alpha vs SPY, clipped at ±3%
 *   return:      clip(avg_return / 0.03) × 1.0  raw return term (weak signal)
 *
 * Maximum possible score ≈ +8.0 (perfect calibration, 100% hit, +3% alpha)
 * Neutral (random guessing): ≈ 0.0
 * Minimum: ≈ -8.0
 */
export function scoreStrategies(rows: ScoringRow[]): StrategyScore[] {
  const byStrategy = new Map<string, ScoringRow[]>()
  for (const r of rows) {
    if (!byStrategy.has(r.strategy)) byStrategy.set(r.strategy, [])
    byStrategy.get(r.strategy)!.push(r)
  }

  const scores: StrategyScore[] = []

  for (const [strategy, outcomes] of byStrategy) {
    if (outcomes.length < MIN_SAMPLES) continue

    const n = outcomes.length

    const brier = outcomes.reduce((s, o) => s + (o.confidence - o.actual_direction) ** 2, 0) / n

    // Hit rate: did we call direction correctly?
    const hit_rate = outcomes.filter(o =>
      (o.confidence >= 0.5 ? 1 : 0) === o.actual_direction
    ).length / n

    // Net returns of round-trip transaction costs (fee + spread) so the score
    // reflects what a real fill would have earned, not the frictionless edge.
    // A strategy that "wins" gross but loses net should rank below cash.
    const costAdj = (o: ScoringRow) =>
      o.assetClass ? roundTripCostBps(o.assetClass) / 10_000 : 0
    const avg_return = outcomes.reduce((s, o) => s + o.actual_return - costAdj(o), 0) / n
    const avg_alpha = outcomes.reduce((s, o) => s + o.alpha_vs_benchmark - costAdj(o), 0) / n

    // Clip return/alpha to ±3% and normalize to [-1, 1]
    const alpha_norm = Math.max(-1, Math.min(1, avg_alpha / 0.03))
    const return_norm = Math.max(-1, Math.min(1, avg_return / 0.03))

    const score =
      (0.25 - brier) * 3.0
      + (hit_rate - 0.5) * 2.0
      + alpha_norm * 2.0
      + return_norm * 1.0

    scores.push({ strategy, count: n, brier, hit_rate, avg_return, avg_alpha, score })
  }

  return scores.sort((a, b) => b.score - a.score)
}
