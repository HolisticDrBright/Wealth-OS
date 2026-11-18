/**
 * POST /api/mobile/resume — turn trading back on. Requires the explicit
 * confirmation flag the phone's confirm step sets; without it, nothing moves.
 */

import { NextRequest, NextResponse } from 'next/server'
import { userClientFromBearer } from '@/lib/supabase/bearer'
import { resumeTradingCore } from '@/lib/simple/pause-core'

export async function POST(req: NextRequest) {
  const ctx = await userClientFromBearer(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { confirm?: boolean }
  if (body.confirm !== true) {
    return NextResponse.json({ error: 'confirmation_required: send { confirm: true }' }, { status: 400 })
  }

  const result = await resumeTradingCore(ctx.supabase, ctx.userId)
  if (!result.ok) return NextResponse.json({ error: result.error ?? 'resume failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
