/**
 * POST /api/cron/sync-kronos
 *
 * Nightly trigger (02:00 UTC) for the per-user Kronos forecast sync.
 * Protected by CRON_SECRET to prevent public access.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runSyncKronos } from '@/lib/workers/sync-kronos'

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const result = await runSyncKronos(supabase)

  return NextResponse.json({ success: true, ...result })
}
