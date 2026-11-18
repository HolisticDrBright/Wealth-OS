import { NextRequest, NextResponse } from 'next/server'
import { runCronTask, UnknownCronTaskError } from '@/lib/cron/tasks'

// Combined tasks run several jobs sequentially — allow up to a minute.
export const maxDuration = 60

// Vercel Cron hits this endpoint via GET.
// Protect with CRON_SECRET to prevent unauthorized triggers.
// FAILS CLOSED: no secret configured = nobody can trigger tasks
// (the old check skipped auth entirely when CRON_SECRET was unset).
// Task bodies live in lib/cron/tasks.ts and make DIRECT function calls —
// no HTTP self-fetch, no cookie, no site-URL dependency.
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const task = req.nextUrl.searchParams.get('task') ?? 'sync'

  try {
    const result = await runCronTask(task)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof UnknownCronTaskError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cron failed' },
      { status: 500 }
    )
  }
}
