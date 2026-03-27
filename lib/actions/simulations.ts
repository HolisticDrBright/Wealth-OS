'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { SimulationJob, SimulationReport } from '@/lib/types'

export async function getSimulationJobs(): Promise<SimulationJob[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('simulation_jobs')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  return data ?? []
}

export async function getSimulationReport(jobId: string): Promise<SimulationReport | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('simulation_reports')
    .select('*')
    .eq('job_id', jobId)
    .eq('user_id', user.id)
    .single()

  return data
}

export async function createSimulationJob(payload: {
  title: string
  description?: string
  asset_class?: string
  symbols?: string[]
  scenario: SimulationJob['scenario']
  horizon_days?: number
  num_simulations?: number
}): Promise<SimulationJob | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: job } = await supabase
    .from('simulation_jobs')
    .insert({
      user_id: user.id,
      horizon_days: 30,
      num_simulations: 1000,
      status: 'pending',
      ...payload,
    })
    .select()
    .single()

  if (job) {
    // Fire-and-forget: kick off the simulation worker
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
    fetch(`${baseUrl}/api/simulations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: job.id }),
    }).catch(() => { /* background worker — ignore errors */ })
  }

  revalidatePath('/risk')
  return job
}
