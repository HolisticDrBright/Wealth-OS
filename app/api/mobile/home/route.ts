/**
 * GET /api/mobile/home — everything the phone's Home screen shows.
 * Auth: Supabase user JWT as Bearer; all queries run as the user under RLS.
 */

import { NextRequest, NextResponse } from 'next/server'
import { userClientFromBearer } from '@/lib/supabase/bearer'
import { buildMobileHome } from '@/lib/simple/mobile-data'

export async function GET(req: NextRequest) {
  const ctx = await userClientFromBearer(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const data = await buildMobileHome(ctx.supabase, ctx.userId)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to load home' },
      { status: 500 }
    )
  }
}
