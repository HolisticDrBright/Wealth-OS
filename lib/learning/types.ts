/**
 * Shared types for the Wealth OS Learning Loop.
 * The loop records every prediction, grades each outcome when the horizon passes,
 * and uses Brier score + hit rate + alpha to adjust strategy weights.
 */

export type LearningStrategy =
  | 'kronos'
  | 'mirofish'
  | 'combined'
  | 'momentum'
  | 'sentiment'

/** One prediction logged at decision time */
export interface DecisionRecord {
  id: string
  user_id: string
  created_at: string
  strategy: LearningStrategy | string
  symbol: string
  /** Probability that price goes UP over the horizon [0, 1] */
  confidence: number
  /** 1 = predicted up, 0 = predicted down */
  predicted_direction: 0 | 1
  /** Expected return % (optional, from Kronos) */
  predicted_return: number | null
  /** Contributing signal weights at time of decision */
  signal_weights: Record<string, number> | null
  /** Days until outcome is measured */
  horizon_days: number
  /** When this decision becomes gradeable */
  resolution_due_at: string
  /** Has this been graded yet? */
  outcome_graded: boolean
  metadata: Record<string, unknown> | null
}

/** Graded outcome linked to a decision */
export interface OutcomeRecord {
  id: string
  decision_id: string
  user_id: string
  resolved_at: string
  /** 1 = price went up, 0 = price went down */
  actual_direction: 0 | 1
  /** Actual % return over horizon */
  actual_return: number
  /** return minus SPY return for same period */
  alpha_vs_benchmark: number
  /** (confidence - actual_direction)^2 — lower is better */
  brier_score: number
  metadata: Record<string, unknown> | null
}

/** Per-strategy performance summary */
export interface StrategyStats {
  strategy: string
  count: number
  /** Mean Brier score — lower is better (0 = perfect, 0.25 = random) */
  brier: number | null
  /** Fraction of correct direction calls */
  hit_rate: number | null
  /** Average actual % return */
  avg_return: number | null
  /** Average alpha vs SPY */
  avg_alpha: number | null
  /** Composite score (higher = better) */
  score: number | null
  /** Current active weight [0, 1] */
  current_weight: number | null
}

/** Shape of the strategy_weights Supabase row */
export interface WeightRow {
  user_id: string
  weights: Record<string, number>
  updated_at: string
}
