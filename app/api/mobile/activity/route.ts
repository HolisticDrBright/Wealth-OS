/**
 * GET /api/mobile/activity — plain-English activity feed (trades, opens,
 * skipped/blocked), newest first. Filtering happens on the device.
 */

import { NextRequest, NextResponse } from 'next/server'
import { userClientFromBearer } from '@/lib/supabase/bearer'
import { buildMobileActivity } from '@/lib/simple/mobile-data'

export async function GET(req: NextRequest) {
  const ctx = await userClientFromBearer(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const items = await buildMobileActivity(ctx.supabase, ctx.userId)
    return NextResponse.json({ items })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to load activity' },
      { status: 500 }
    )
  }
}
