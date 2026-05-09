/**
 * GET /api/learning/debug
 *
 * Diagnostic endpoint — shows the exact state of every table in the
 * learning loop pipeline so you can see exactly where data is missing.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const uid = user.id

  const [
    { count: posOpen },
    { count: posClosed },
    { count: decTotal },
    { count: decGraded },
    { count: decUngraded },
    { count: decLinked },
    { count: outcomes },
    { data: recentPos },
    { data: recentDec },
    { data: recentOut },
  ] = await Promise.all([
    admin.from('paper_positions').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'open'),
    admin.from('paper_positions').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'closed'),
    admin.from('decision_log').select('id', { count: 'exact', head: true }).eq('user_id', uid),
    admin.from('decision_log').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('outcome_graded', true),
    admin.from('decision_log').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('outcome_graded', false),
    admin.from('decision_log').select('id', { count: 'exact', head: true }).eq('user_id', uid).not('paper_position_id', 'is', null),
    admin.from('outcome_log').select('id', { count: 'exact', head: true }).eq('user_id', uid),
    admin.from('paper_positions').select('id, strategy_key, status, opened_at, closed_at, realized_pnl_pct').eq('user_id', uid).order('opened_at', { ascending: false }).limit(5),
    admin.from('decision_log').select('id, strategy, asset_class, outcome_graded, resolution_due_at, paper_position_id').eq('user_id', uid).order('created_at', { ascending: false }).limit(5),
    admin.from('outcome_log').select('id, actual_direction, actual_return, brier_score, resolved_at').eq('user_id', uid).order('resolved_at', { ascending: false }).limit(5),
  ])

  // Check if asset_class and paper_position_id columns exist
  const { error: colCheckErr } = await admin
    .from('decision_log')
    .select('asset_class, paper_position_id')
    .eq('user_id', uid)
    .limit(1)

  const columnsOk = !colCheckErr

  return NextResponse.json({
    migration_applied: columnsOk,
    migration_needed: !columnsOk ? 'Run supabase/migrations/20260509_learning_loop_columns.sql in Supabase SQL editor' : null,
    paper_positions: { open: posOpen ?? 0, closed: posClosed ?? 0, recent: recentPos },
    decision_log: {
      total: decTotal ?? 0,
      graded: decGraded ?? 0,
      ungraded: decUngraded ?? 0,
      linked_to_position: decLinked ?? 0,
      recent: recentDec,
    },
    outcome_log: { total: outcomes ?? 0, recent: recentOut },
    diagnosis: buildDiagnosis({ columnsOk, posClosed, decTotal, outcomes }),
  })
}

function buildDiagnosis(d: {
  columnsOk: boolean
  posClosed: number | null
  decTotal: number | null
  outcomes: number | null
}): string {
  if (!d.columnsOk) {
    return 'BLOCKED: decision_log is missing asset_class and/or paper_position_id columns. Run the migration SQL, then call POST /api/learning/backfill.'
  }
  if (!d.posClosed) {
    return 'WAITING: no closed positions yet. The loop needs at least one closed paper trade to score.'
  }
  if (!d.decTotal) {
    return 'ACTION NEEDED: positions have closed but decision_log is empty. Call POST /api/learning/backfill to create historical records.'
  }
  if (!d.outcomes) {
    return 'IN PROGRESS: decision_log has entries but outcome_log is empty. The next learning pass (or backfill) will grade them.'
  }
  return 'OK: pipeline has data. Call POST /api/learning to run a scoring pass.'
}
