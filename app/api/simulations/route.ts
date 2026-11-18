import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { apiSuccess, apiError } from '@/lib/api'
import { runSimulationJob } from '@/lib/workers/simulation-runner'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const body = await req.json().catch(() => ({}))
  const { job_id } = body

  if (!job_id) return apiError('job_id required', 400)

  const adminSupabase = createAdminClient()

  // Verify ownership before running — the worker itself is caller-agnostic.
  const { data: job, error: jobErr } = await adminSupabase
    .from('simulation_jobs')
    .select('id')
    .eq('id', job_id)
    .eq('user_id', user.id)
    .single()

  if (jobErr || !job) return apiError('Job not found', 404)

  const result = await runSimulationJob(adminSupabase, job_id)
  if (!result.ok) return apiError(result.error, 500)
  if (result.alreadyCompleted) return apiSuccess({ message: 'Already completed' })
  return apiSuccess({ job_id, report_id: result.report_id })
}
