/**
 * Calibration Monitor — automatic strategy retirement (T4.7).
 *
 * Daily check: if a strategy has 90-day Sharpe < 0 AND 30-day Brier > 0.25,
 * it is auto-disabled in user_enabled_strategies for all users and logged to
 * strategy_retirement_log for audit trail.
 *
 * Manual re-enable is possible via Settings → AI Features.
 *
 * Designed to be called from a cron/scheduled task (e.g. task=calibration-check).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface RetirementResult {
  strategyKey: string
  reason: string
  sharpe90d: number
  brier30d: number
  usersDisabled: number
}

const MIN_TRADES_FOR_SHARPE = 20
const MIN_OUTCOMES_FOR_BRIER = 10
const SHARPE_THRESHOLD = 0      // retire if < 0
const BRIER_THRESHOLD  = 0.25   // retire if > 0.25

// ─── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = { from: (table: string) => any }

async function compute90dSharpe(
  supabase: AnySupabase,
  strategyKey: string
): Promise<number | null> {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString()
  const { data } = await supabase
    .from('outcome_records')
    .select('actual_return, decision:decision_records!inner(strategy, created_at)')
    .eq('decision.strategy', strategyKey)
    .gte('decision.created_at', since) as { data: Array<{ actual_return: number }> | null }

  if (!data || data.length < MIN_TRADES_FOR_SHARPE) return null

  const returns = data.map(r => r.actual_return)
  const n = returns.length
  const mean = returns.reduce((s, r) => s + r, 0) / n
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1)
  const stddev = Math.sqrt(variance)
  if (stddev === 0) return null

  // Annualise: assume ~252 trading periods per year
  return (mean / stddev) * Math.sqrt(252)
}

async function compute30dBrier(
  supabase: AnySupabase,
  strategyKey: string
): Promise<number | null> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { data } = await supabase
    .from('outcome_records')
    .select('brier_score, decision:decision_records!inner(strategy, created_at)')
    .eq('decision.strategy', strategyKey)
    .gte('decision.created_at', since) as { data: Array<{ brier_score: number }> | null }

  if (!data || data.length < MIN_OUTCOMES_FOR_BRIER) return null

  const scores = data.map(r => r.brier_score)
  return scores.reduce((s, b) => s + b, 0) / scores.length
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Checks all strategies and disables any that fail the calibration gate.
 * Returns a list of strategies that were auto-retired.
 */
export async function runCalibrationMonitor(
  supabase: SupabaseClient,
  strategyKeys: string[]
): Promise<RetirementResult[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any as AnySupabase
  const retired: RetirementResult[] = []

  for (const key of strategyKeys) {
    const [sharpe, brier] = await Promise.all([
      compute90dSharpe(db, key),
      compute30dBrier(db, key),
    ])

    if (sharpe === null || brier === null) continue

    if (sharpe >= SHARPE_THRESHOLD || brier <= BRIER_THRESHOLD) continue

    // Both conditions met → auto-retire
    const reason = `90d Sharpe ${sharpe.toFixed(2)} < 0 AND 30d Brier ${brier.toFixed(3)} > 0.25`

    // Disable for all users
    const { data: enabledRows } = await db
      .from('user_enabled_strategies')
      .select('user_id')
      .eq('strategy_key', key)
      .eq('enabled', true) as { data: Array<{ user_id: string }> | null }

    const userIds = (enabledRows ?? []).map((r: { user_id: string }) => r.user_id)

    if (userIds.length > 0) {
      await db
        .from('user_enabled_strategies')
        .update({ enabled: false, disabled_reason: reason, disabled_at: new Date().toISOString() })
        .eq('strategy_key', key)
        .eq('enabled', true)
    }

    // Audit log
    await db
      .from('strategy_retirement_log')
      .insert({
        strategy_key: key,
        retired_at: new Date().toISOString(),
        reason,
        sharpe_90d: sharpe,
        brier_30d: brier,
        users_disabled: userIds.length,
      })

    retired.push({
      strategyKey: key,
      reason,
      sharpe90d: sharpe,
      brier30d: brier,
      usersDisabled: userIds.length,
    })
  }

  return retired
}
