/**
 * The Wealth OS Learning Loop.
 *
 * Closed-loop pipeline:
 *  1. Grade any unresolved decisions whose horizon has passed (fetch real prices)
 *  2. Query all resolved outcomes joined with their decision records
 *     → Fallback: if outcome_log is empty, score directly from closed paper_positions
 *       (works before the decision_log migration is applied)
 *  3. Score each strategy: Brier + hit rate + alpha vs benchmark
 *  4. Softmax → normalized target weights
 *  5. Clamp evolution (max 8% change per cycle) + per-strategy floors
 *  6. Save weights to Supabase if materially changed (>1%)
 *
 * Never throws — if the pass fails, caller keeps using current weights.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { getBarsReal, normaliseSymbolForGrading } from '@/lib/market-data'
import { roundTripCostBps } from '@/lib/costs/transaction-costs'
import { scoreStrategies, type StrategyScore, type ScoringRow } from './scorer'
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
  source?: 'outcome_log' | 'paper_positions'
}

// ─── Outcome grader ───────────────────────────────────────────────────────────

/**
 * Find ungraded decisions and write outcome records.
 * Pass 1: closed positions linked via paper_position_id — uses realized P&L, no price bars needed.
 * Pass 2: past-horizon decisions without a position link — fetches real price bars.
 * Returns the number of newly graded decisions.
 */
async function gradeOutcomes(userId: string): Promise<number> {
  const admin = createAdminClient()
  const now = new Date().toISOString()
  let graded = 0

  // ── Pass 1: grade decisions linked to CLOSED positions using realized P&L ──
  // Fires immediately when a position closes — no horizon wait, no price bars.
  // Rescues cases where PaperBroker's inline grader failed silently.
  const { data: linkedPending } = await admin
    .from('decision_log')
    .select('id, confidence, paper_position_id')
    .eq('user_id', userId)
    .eq('outcome_graded', false)
    .not('paper_position_id', 'is', null)
    .limit(100)

  if (linkedPending?.length) {
    const posIds = linkedPending.map(d => d.paper_position_id as string)
    const { data: closedPos } = await admin
      .from('paper_positions')
      .select('id, realized_pnl_pct, realized_pnl_usd, status')
      .in('id', posIds)
      .eq('status', 'closed')

    const closedMap = new Map((closedPos ?? []).map(p => [p.id as string, p]))

    for (const dec of linkedPending) {
      const pos = closedMap.get(dec.paper_position_id as string)
      if (!pos) continue
      const actualDirection: 0 | 1 = (pos.realized_pnl_usd as number) >= 0 ? 1 : 0
      const brierScore = ((dec.confidence as number) - actualDirection) ** 2
      const [{ error: outErr }] = await Promise.all([
        admin.from('outcome_log').insert({
          decision_id:        dec.id,
          user_id:            userId,
          actual_direction:   actualDirection,
          actual_return:      pos.realized_pnl_pct as number,
          alpha_vs_benchmark: 0,
          brier_score:        brierScore,
        }),
        admin.from('decision_log').update({ outcome_graded: true }).eq('id', dec.id as string),
      ])
      if (!outErr) graded++
    }
  }

  // ── Pass 2: grade past-horizon decisions using real price bars ────────────
  // Only for decisions without a paper_position_id (legacy/non-position signals).
  const { data: pending } = await admin
    .from('decision_log')
    .select('id, symbol, asset_class, confidence, created_at, horizon_days')
    .eq('user_id', userId)
    .eq('outcome_graded', false)
    .is('paper_position_id', null)
    .lte('resolution_due_at', now)
    .limit(50)

  for (const decision of pending ?? []) {
    try {
      const start = (decision.created_at as string).slice(0, 10)
      const end = new Date().toISOString().slice(0, 10)
      if (start === end) continue

      const assetClass = (decision.asset_class as string) ?? 'stocks'
      const gradingSymbol = normaliseSymbolForGrading(decision.symbol as string, assetClass)
      const benchSymbol =
        assetClass === 'crypto' ? 'BTC-USD'
        : assetClass === 'forex' ? null
        : 'SPY'

      const [assetBars, benchBars] = await Promise.all([
        getBarsReal(gradingSymbol, start, end),
        benchSymbol ? getBarsReal(benchSymbol, start, end) : Promise.resolve([]),
      ])

      if (assetBars.length < 2) continue
      if (benchSymbol && benchBars.length < 2) continue

      const entryPrice = assetBars[0].close
      const exitPrice  = assetBars[assetBars.length - 1].close
      // Bar closes are frictionless midpoints — net out the round-trip cost
      // (fee + spread both ways) so grading matches what a real fill earns.
      // Pass 1 (paper positions) already paid slippage at fill time, so this
      // adjustment applies only to bar-graded decisions.
      const grossReturn = (exitPrice - entryPrice) / entryPrice
      const actual_return = grossReturn - roundTripCostBps(assetClass) / 10_000
      const bench_return  = benchBars.length >= 2
        ? (benchBars[benchBars.length - 1].close - benchBars[0].close) / benchBars[0].close
        : 0
      const alpha_vs_benchmark = actual_return - bench_return
      const actual_direction: 0 | 1 = actual_return >= 0 ? 1 : 0
      const brier_score = ((decision.confidence as number) - actual_direction) ** 2

      await Promise.all([
        admin.from('outcome_log').insert({
          decision_id: decision.id,
          user_id: userId,
          actual_direction,
          actual_return,
          alpha_vs_benchmark,
          brier_score,
        }),
        admin.from('decision_log').update({ outcome_graded: true }).eq('id', decision.id as string),
      ])
      graded++
    } catch {
      // No real price data available — decision stays pending
    }
  }

  return graded
}

// ─── Main pass ────────────────────────────────────────────────────────────────

export async function runLearningPass(userId: string): Promise<LearningPassResult> {
  try {
    // Step 1: grade any pending decisions
    const graded = await gradeOutcomes(userId)

    const admin = createAdminClient()

    // Step 2a: primary source — outcome_log joined with decision_log
    const { data: outcomes } = await admin
      .from('outcome_log')
      .select('actual_direction, actual_return, alpha_vs_benchmark, decision:decision_log(strategy, confidence)')
      .eq('user_id', userId)

    let rows: ScoringRow[] = []
    let source: LearningPassResult['source'] = 'outcome_log'

    if (outcomes?.length) {
      rows = outcomes
        .filter((o): o is typeof o & { decision: { strategy: string; confidence: number } } =>
          o.decision != null && typeof o.decision === 'object'
        )
        .map(o => ({
          strategy:           o.decision.strategy,
          confidence:         o.decision.confidence,
          actual_direction:   o.actual_direction as number,
          actual_return:      o.actual_return as number,
          alpha_vs_benchmark: o.alpha_vs_benchmark as number,
        }))
      // If the FK join dropped a significant fraction of outcomes (orphaned rows),
      // fall through to the paper_positions fallback which has the full history.
      if (rows.length < outcomes.length * 0.5) {
        rows = []
      }
    }

    // Step 2b: fallback — score directly from closed paper_positions.
    // Activates when outcome_log is empty (migration not yet run, or backfill not done).
    // Includes all asset classes — realized_pnl_usd comes from the position record
    // directly, not from price bars, so polymarket and forex are safe to include.
    if (!rows.length) {
      source = 'paper_positions'
      const { data: closed } = await admin
        .from('paper_positions')
        .select('strategy_key, realized_pnl_pct, realized_pnl_usd')
        .eq('user_id', userId)
        .eq('status', 'closed')
        .limit(5000)

      if (!closed?.length) {
        return { updated: false, reason: 'no closed positions yet — keep paper trading', graded }
      }

      rows = closed.map(p => ({
        strategy:           p.strategy_key as string,
        confidence:         0.6,  // default prior, same as backfill
        // null realized_pnl_usd (timeout close where price update failed) treated as breakeven
        actual_direction:   ((p.realized_pnl_usd as number | null) ?? 0) >= 0 ? 1 : 0,
        actual_return:      (p.realized_pnl_pct as number | null) ?? 0,
        alpha_vs_benchmark: 0,
      }))
    }

    // Step 3: compute per-strategy scores
    const scores = scoreStrategies(rows)

    if (!scores.length) {
      const counts = new Map<string, number>()
      for (const r of rows) counts.set(r.strategy, (counts.get(r.strategy) ?? 0) + 1)
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
      const top5 = sorted.slice(0, 5).map(([s, n]) => `${s}:${n}`).join(', ')
      const maxCount = sorted[0]?.[1] ?? 0
      return {
        updated: false,
        reason: `not enough trades per strategy — need ${MIN_SAMPLES}+, max is ${maxCount} (top: ${top5})`,
        graded,
        source,
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
      return { updated: false, reason: 'no material change (max delta < 1%)', graded, scores, source }
    }

    await saveWeightsForUser(userId, evolved)

    return {
      updated: true,
      reason: `deployed new weights (max delta ${(maxDelta * 100).toFixed(1)}%)`,
      graded,
      weights: evolved,
      scores,
      max_delta: maxDelta,
      source,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { updated: false, reason: `error: ${msg}` }
  }
}
