/**
 * GET  /api/mobile/pause — live impact for the Pause screen: open positions,
 *      value, estimated exit cost, pending orders, current halt state.
 * POST /api/mobile/pause — pause everything ({ sell_explore: boolean }).
 *      Same core as the web's Flatten & Halt: halt flag FIRST, pending order
 *      intents cancelled, optionally every open paper position closed through
 *      the runner's exit path, audit_logs row written.
 */

import { NextRequest, NextResponse } from 'next/server'
import { userClientFromBearer } from '@/lib/supabase/bearer'
import { buildPauseImpact } from '@/lib/simple/mobile-data'
import { pauseTradingCore } from '@/lib/simple/pause-core'

export async function GET(req: NextRequest) {
  const ctx = await userClientFromBearer(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const impact = await buildPauseImpact(ctx.supabase, ctx.userId)
    return NextResponse.json(impact)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to load impact' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const ctx = await userClientFromBearer(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { sell_explore?: boolean }
  const result = await pauseTradingCore(ctx.supabase, ctx.userId, {
    sellExplore: body.sell_explore === true,
    reason: body.sell_explore ? 'paused from phone — sell Explore' : 'paused from phone — keep holdings',
  })

  if (result.error) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({
    ok: result.ok,
    closed: result.closed,
    cancelledOrders: result.cancelledOrders,
    failures: result.failures,
  })
}
