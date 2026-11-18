/**
 * GET /api/mobile/explore — the Explore screen: cap usage meter + trader
 * cards with copier-adjusted results, swing labels and practice runs.
 * The phone is the simple experience: ranking is always risk/delay-adjusted.
 */

import { NextRequest, NextResponse } from 'next/server'
import { userClientFromBearer } from '@/lib/supabase/bearer'
import { buildExploreData } from '@/lib/explore/view-data'

export async function GET(req: NextRequest) {
  const ctx = await userClientFromBearer(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const data = await buildExploreData(ctx.supabase, ctx.userId, 'simple')
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to load explore' },
      { status: 500 }
    )
  }
}
