/**
 * POST /api/mobile/deposit — add practice money ({ amount_usd }). Same core as
 * the web's "Add money" (depositFunds): the deposit is recorded, then it fills
 * Tier 1 Safety first and Core next — the fund furthest below target first.
 * Never added to strategy (Explore) equity. Paper only; RLS as the user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { userClientFromBearer } from '@/lib/supabase/bearer'
import { depositFunds } from '@/lib/allocation/ladder-data'

export async function POST(req: NextRequest) {
  const ctx = await userClientFromBearer(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { amount_usd?: number }
  const amount = Number(body.amount_usd)
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount_usd must be more than 0' }, { status: 400 })
  }

  const res = await depositFunds(ctx.supabase, ctx.userId, amount)
  if (res.error) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({
    ok: res.ok, safetyUsd: res.safetyUsd, coreUsd: res.coreUsd,
    executed: res.executed, errors: res.failures,
  })
}
