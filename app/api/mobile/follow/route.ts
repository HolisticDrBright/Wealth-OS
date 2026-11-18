/**
 * POST /api/mobile/follow — follow ({ trader_id, approved_summary }) or
 * unfollow ({ trader_id, unfollow: true }) a trader. Following from the phone
 * always requires the explicitly approved plain-language summary (recorded),
 * the same bar as web simple mode. Auto-copy cannot be enabled from the phone
 * at all — it stays behind the 30-day practice run on the web.
 */

import { NextRequest, NextResponse } from 'next/server'
import { userClientFromBearer } from '@/lib/supabase/bearer'

export async function POST(req: NextRequest) {
  const ctx = await userClientFromBearer(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    trader_id?: string
    approved_summary?: string
    unfollow?: boolean
  }
  if (!body.trader_id) return NextResponse.json({ error: 'trader_id required' }, { status: 400 })

  if (body.unfollow) {
    const { error } = await ctx.supabase
      .from('user_followed_traders')
      .delete()
      .eq('user_id', ctx.userId)
      .eq('trader_id', body.trader_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const summary = body.approved_summary?.trim()
  if (!summary) {
    return NextResponse.json({ error: 'approval_required: approved_summary missing' }, { status: 400 })
  }

  const { error: apprErr } = await ctx.supabase.from('automation_approvals').insert({
    user_id: ctx.userId, kind: 'follow_trader', subject: body.trader_id, summary,
  })
  if (apprErr) return NextResponse.json({ error: `could not record approval: ${apprErr.message}` }, { status: 500 })

  const { error } = await ctx.supabase.from('user_followed_traders').insert({
    user_id: ctx.userId,
    trader_id: body.trader_id,
    auto_copy_enabled: false,
    max_allocation_pct_per_trade: 5,
    risk_level: 'moderate',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
