import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runTraderSync } from '@/lib/workers/trader-sync'

// ─── Main sync handler — body lives in lib/workers/trader-sync.ts ───────────

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, { status: 500 })
  }

  const body = await req.json().catch(() => ({}))
  const sources: string[] = body.sources ?? ['all']

  const result = await runTraderSync(createAdminClient(), sources)
  return NextResponse.json(result)
}

export async function GET() {
  return NextResponse.json({
    message: 'POST to /api/sync with optional { sources: ["all"] } to run sync',
    available_sources: ['all', 'unusual_whales', 'quiver_quant', 'nansen', 'arkham', 'myfxbook', 'polymarket'],
    required_env_vars: [
      'SUPABASE_SERVICE_ROLE_KEY (required)',
      'UNUSUAL_WHALES_API_KEY (optional)',
      'QUIVER_QUANT_API_KEY (optional)',
      'NANSEN_API_KEY (optional)',
      'ARKHAM_API_KEY (optional)',
      'MYFXBOOK_SESSION (optional)',
      'POLYMARKET_API_KEY (optional)',
    ],
  })
}
