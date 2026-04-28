/**
 * POST /api/learning/backfill
 *
 * Creates decision_log entries for any open paper positions that were opened
 * before the PaperBroker auto-logging was added. Safe to run multiple times —
 * skips positions that already have a decision_log row.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const HORIZON_BY_CLASS: Record<string, number> = {
  stocks: 5, options: 5, crypto: 3, forex: 2, 'multi-asset': 3,
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get all open non-polymarket positions
  const { data: positions, error: posErr } = await supabase
    .from('paper_positions')
    .select('id, strategy_key, symbol, asset_class, direction, entry_price, opened_at')
    .eq('user_id', user.id)
    .eq('status', 'open')
    .neq('asset_class', 'polymarket')

  if (posErr) return NextResponse.json({ error: posErr.message }, { status: 500 })
  if (!positions?.length) return NextResponse.json({ backfilled: 0, skipped: 0 })

  // Get existing decision_log entries for these positions
  const { data: existing } = await supabase
    .from('decision_log')
    .select('paper_position_id')
    .eq('user_id', user.id)
    .in('paper_position_id', positions.map(p => p.id))

  const alreadyLogged = new Set((existing ?? []).map(e => e.paper_position_id as string))

  const toInsert = positions
    .filter(p => !alreadyLogged.has(p.id as string))
    .map(p => {
      const horizonDays = HORIZON_BY_CLASS[p.asset_class as string] ?? 5
      const openedAt = new Date(p.opened_at as string)
      const resolutionDue = new Date(openedAt.getTime() + horizonDays * 86_400_000).toISOString()
      return {
        user_id:           user.id,
        strategy:          p.strategy_key as string,
        symbol:            p.symbol as string,
        confidence:        0.6,   // conservative default for backfilled entries
        direction:         p.direction as string,
        horizon_days:      horizonDays,
        resolution_due_at: resolutionDue,
        outcome_graded:    false,
        paper_position_id: p.id as string,
      }
    })

  if (!toInsert.length) {
    return NextResponse.json({ backfilled: 0, skipped: alreadyLogged.size })
  }

  const { error: insErr } = await supabase.from('decision_log').insert(toInsert)
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  return NextResponse.json({ backfilled: toInsert.length, skipped: alreadyLogged.size })
}
