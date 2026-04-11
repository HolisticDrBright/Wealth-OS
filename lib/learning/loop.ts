/**
 * The Wealth OS Learning Loop.
 *
 * Closed-loop pipeline:
 *  1. Grade any unresolved decisions whose horizon has passed (fetch real prices)
 *  2. Query all resolved outcomes joined with their decision records
 *  3. Score each strategy: Brier + hit rate + alpha vs benchmark
 *  4. Softmax → normalized target weights
 *  5. Clamp evolution (max 8% change per cycle) + per-strategy floors
 *  6. Save weights to Supabase if materially changed (>1%)
 *
 * Never throws — if the pass fails, caller keeps using current weights.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { getBars } from '@/lib/market-data'
import { scoreStrategies, type StrategyScore } from './scorer'
import {
  loadWeightsForUser,
  saveWeightsForUser,
  softmax,
  clampEvolution,
  MIN_SAMPLES,
} from './weights'

export interface LearningPassResult {
  updated: boolean
  reason: string
  graded?: number
  weights?: Record<string, number>
  scores?: StrategyScore[]
  max_delta?: number
}

// ─── Outcome grader ───────────────────────────────────────────────────────────

/**
 * Find ungraded decisions whose resolution_due_at has passed,
 * fetch actual price data, and write outcome records.
 * Returns the number of newly graded decisions.
 */
async function gradeOutcomes(userId: string): Promise<number> {
  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data: pending } = await admin
    .from('decision_log')
    .select('id, symbol, confidence, created_at, horizon_days')
    .eq('user_id', userId)
    .eq('outcome_graded', false)
    .lte('resolution_due_at', now)
    .limit(50)  // grade in batches

  if (!pending?.length) return 0

  let graded = 0

  for (const decision of pending) {
    try {
      const start = decision.created_at.slice(0, 10)
      const end = new Date().toISOString().slice(0, 10)

      if (start === end) continue  // can't grade same-day

      const [assetBars, benchBars] = await Promise.all([
        getBars(decision.symbol, start, end),
        getBars('SPY', start, end),
      ])

      if (assetBars.length < 2 || benchBars.length < 2) continue

      const entryPrice = assetBars[0].close
      const exitPrice = assetBars[assetBars.length - 1].close
      const benchEntry = benchBars[0].close
      const benchExit = benchBars[benchBars.length - 1].close

      const actual_return = (exitPrice - entryPrice) / entryPrice
      const bench_return = (benchExit - benchEntry) / benchEntry
      const alpha_vs_benchmark = actual_return - bench_return
      const actual_direction: 0 | 1 = actual_return >= 0 ? 1 : 0
      const brier_score = (decision.confidence - actual_direction) ** 2

      await Promise.all([
        admin.from('outcome_log').insert({
          decision_id: decision.id,
          user_id: userId,
          actual_direction,
          actual_return,
          alpha_vs_benchmark,
          brier_score,
        }),
        admin.from('decision_log')
          .update({ outcome_graded: true })
          .eq('id', decision.id),
      ])

      graded++
    } catch {
      // Skip if price data unavailable — decision stays ungraded
    }
  }

  return graded
}

// ─── Main pass ────────────────────────────────────────────────────────────────

export async function runLearningPass(userId: string): Promise<LearningPassResult> {
  try {
    // Step 1: grade any pending decisions
    const graded = await gradeOutcomes(userId)

    // Step 2: fetch all resolved outcomes with their decision context
    const admin = createAdminClient()
    const { data: outcomes } = await admin
      .from('outcome_log')
      .select('actual_direction, actual_return, alpha_vs_benchmark, decision:decision_log(strategy, confidence)')
      .eq('user_id', userId)

    if (!outcomes?.length) {
      return { updated: false, reason: 'no outcome data yet', graded }
    }

    const rows = outcomes
      .filter((o): o is typeof o & { decision: { strategy: string; confidence: number } } =>
        o.decision != null
      )
      .map(o => ({
        strategy: o.decision.strategy,
        confidence: o.decision.confidence,
        actual_direction: o.actual_direction as number,
        actual_return: o.actual_return as number,
        alpha_vs_benchmark: o.alpha_vs_benchmark as number,
      }))

    // Step 3: compute per-strategy scores
    const scores = scoreStrategies(rows)

    if (!scores.length) {
      return {
        updated: false,
        reason: `not enough data — need ${MIN_SAMPLES}+ resolved outcomes per strategy`,
        graded,
      }
    }

    // Step 4: softmax → normalized target weights
    const rawScores = Object.fromEntries(scores.map(s => [s.strategy, s.score]))
    const target = softmax(rawScores)

    // Step 5: clamp evolution from current weights
    const current = await loadWeightsForUser(userId)
    const evolved = clampEvolution(current, target)

    // Step 6: skip write if no material change
    const maxDelta = Math.max(
      ...Object.keys({ ...current, ...evolved }).map(k =>
        Math.abs((evolved[k] ?? 0) - (current[k] ?? 0))
      )
    )

    if (maxDelta < 0.01) {
      return { updated: false, reason: 'no material change (max delta < 1%)', graded, scores }
    }

    await saveWeightsForUser(userId, evolved)

    return {
      updated: true,
      reason: `deployed new weights (max delta ${(maxDelta * 100).toFixed(1)}%)`,
      graded,
      weights: evolved,
      scores,
      max_delta: maxDelta,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { updated: false, reason: `error: ${msg}` }
  }
}
