import { NextRequest, NextResponse } from 'next/server'

// Vercel Cron hits this endpoint via GET
// Protect with CRON_SECRET to prevent unauthorized triggers
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const task = req.nextUrl.searchParams.get('task') ?? 'sync'
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

  try {
    if (task === 'sync') {
      const res = await fetch(`${baseUrl}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: ['all'] }),
      })
      const data = await res.json()
      return NextResponse.json({ task: 'sync', result: data })
    }

    if (task === 'copy') {
      const res = await fetch(`${baseUrl}/api/execute-copy-trades`, {
        method: 'POST',
      })
      const data = await res.json()
      return NextResponse.json({ task: 'copy', result: data })
    }

    if (task === 'simulate') {
      // Find pending jobs and kick them off
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const supabase = createAdminClient()
      const { data: pendingJobs } = await supabase
        .from('simulation_jobs')
        .select('id')
        .eq('status', 'pending')
        .limit(5)

      const results = await Promise.allSettled(
        (pendingJobs ?? []).map(job =>
          fetch(`${baseUrl}/api/simulations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_id: job.id }),
          }).then(r => r.json())
        )
      )
      return NextResponse.json({ task: 'simulate', dispatched: pendingJobs?.length ?? 0, results })
    }

    return NextResponse.json({ error: `Unknown task: ${task}` }, { status: 400 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cron failed' },
      { status: 500 }
    )
  }
}
