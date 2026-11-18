/**
 * GET  /api/mobile/goal — goal detail: all goals, dollar year-range,
 *      Core/Explore split, Explore usage.
 * POST /api/mobile/goal — change a goal's monthly deposit
 *      ({ goal_id, monthly_contribution_usd }). Not a trading write; RLS
 *      (household owner) protects the row.
 */

import { NextRequest, NextResponse } from 'next/server'
import { userClientFromBearer } from '@/lib/supabase/bearer'
import { buildMobileGoal } from '@/lib/simple/mobile-data'

export async function GET(req: NextRequest) {
  const ctx = await userClientFromBearer(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const data = await buildMobileGoal(ctx.supabase, ctx.userId)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to load goal' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const ctx = await userClientFromBearer(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { goal_id?: string; monthly_contribution_usd?: number }
  const amount = Number(body.monthly_contribution_usd)
  if (!body.goal_id || !Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: 'goal_id and a non-negative monthly_contribution_usd are required' }, { status: 400 })
  }

  const { error, data } = await ctx.supabase
    .from('household_goals')
    .update({ monthly_contribution_usd: amount, updated_at: new Date().toISOString() })
    .eq('id', body.goal_id)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'goal not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
