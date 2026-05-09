/**
 * POST /api/learning/backfill
 *
 * Backfills decision_log + outcome_log for paper positions that existed
 * before the auto-logging was added to PaperBroker.
 *
 * - Open positions  → creates decision_log entry (pending grade)
 * - Closed positions → creates decision_log + outcome_log using realized P&L
 *
 * Safe to run multiple times — skips anything already logged.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const HORIZON_BY_CLASS: Record<string, number> = {
  stocks: 5, options: 5, crypto: 3, forex: 2, 'multi-asset': 3,
}
const DEFAULT_CONFIDENCE = 0.6

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch ALL positions (open and closed), excluding polymarket
  const { data: positions, error: posErr } = await supabase
    .from('paper_positions')
    .select('id, strategy_key, symbol, asset_class, direction, opened_at, status, realized_pnl_pct, realized_pnl_usd, closed_at')
    .eq('user_id', user.id)
    .neq('asset_class', 'polymarket')

  if (posErr) return NextResponse.json({ error: posErr.message }, { status: 500 })
  if (!positions?.length) return NextResponse.json({ openBackfilled: 0, closedBackfilled: 0, skipped: 0 })

  // Find which positions already have decision_log entries
  const { data: existing } = await supabase
    .from('decision_log')
    .select('paper_position_id')
    .eq('user_id', user.id)
    .in('paper_position_id', positions.map(p => p.id))

  const alreadyLogged = new Set((existing ?? []).map(e => e.paper_position_id as string))

  const unlogged = positions.filter(p => !alreadyLogged.has(p.id as string))
  if (!unlogged.length) {
    return NextResponse.json({ openBackfilled: 0, closedBackfilled: 0, skipped: alreadyLogged.size })
  }

  const openPositions   = unlogged.filter(p => p.status === 'open')
  const closedPositions = unlogged.filter(p => p.status === 'closed')

  let openBackfilled = 0
  let closedBackfilled = 0

  // ── Open positions: create pending decision_log entries ─────────────────────
  if (openPositions.length) {
    const rows = openPositions.map(p => {
      const horizonDays = HORIZON_BY_CLASS[p.asset_class as string] ?? 5
      const resolutionDue = new Date(
        new Date(p.opened_at as string).getTime() + horizonDays * 86_400_000
      ).toISOString()
      return {
        user_id:             user.id,
        strategy:            p.strategy_key as string,
        symbol:              p.symbol as string,
        confidence:          DEFAULT_CONFIDENCE,
        predicted_direction: (p.direction as string) === 'long' ? 1 : 0,
        asset_class:         p.asset_class as string,
        horizon_days:        horizonDays,
        resolution_due_at:   resolutionDue,
        outcome_graded:      false,
        paper_position_id:   p.id as string,
      }
    })
    const { error } = await supabase.from('decision_log').insert(rows)
    if (!error) openBackfilled = rows.length
  }

  // ── Closed positions: create decision_log + outcome_log immediately ─────────
  for (const p of closedPositions) {
    const horizonDays = HORIZON_BY_CLASS[p.asset_class as string] ?? 5
    const closedAt = (p.closed_at as string) ?? new Date().toISOString()
    const realizedPct = (p.realized_pnl_pct as number) ?? 0
    const realizedUsd = (p.realized_pnl_usd as number) ?? 0
    const actualDirection = realizedUsd >= 0 ? 1 : 0
    const brierScore = (DEFAULT_CONFIDENCE - actualDirection) ** 2

    // Insert decision_log row (already resolved)
    const { data: dec, error: decErr } = await supabase
      .from('decision_log')
      .insert({
        user_id:           user.id,
        strategy:          p.strategy_key as string,
        symbol:            p.symbol as string,
        confidence:        DEFAULT_CONFIDENCE,
        predicted_direction: (p.direction as string) === 'long' ? 1 : 0,
        asset_class:         p.asset_class as string,
        horizon_days:        horizonDays,
        resolution_due_at:   closedAt,
        outcome_graded:      true,
        paper_position_id:   p.id as string,
      })
      .select('id')
      .single()

    if (decErr || !dec) continue

    // Insert outcome_log row using actual realized P&L
    const { error: outErr } = await supabase.from('outcome_log').insert({
      decision_id:        dec.id,
      user_id:            user.id,
      actual_direction:   actualDirection,
      actual_return:      realizedPct,
      alpha_vs_benchmark: 0,
      brier_score:        brierScore,
    })

    if (!outErr) closedBackfilled++
  }

  return NextResponse.json({
    openBackfilled,
    closedBackfilled,
    skipped: alreadyLogged.size,
    total: openBackfilled + closedBackfilled,
  })
}
