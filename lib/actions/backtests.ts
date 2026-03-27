'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { BacktestJob, BacktestResult } from '@/lib/types'

export async function getBacktestJobs(): Promise<BacktestJob[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('backtest_jobs')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  return data ?? []
}

export async function getBacktestJob(id: string): Promise<BacktestJob | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('backtest_jobs')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  return data
}

export async function getBacktestResult(jobId: string): Promise<BacktestResult | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('backtest_results')
    .select('*')
    .eq('job_id', jobId)
    .eq('user_id', user.id)
    .single()

  return data
}

export async function createBacktestJob(payload: {
  name: string
  description?: string
  symbols: string[]
  asset_class?: string
  start_date: string
  end_date: string
  initial_capital_usd?: number
  rebalance_frequency?: BacktestJob['rebalance_frequency']
  benchmark_symbol?: string
  strategy_id?: string
}): Promise<BacktestJob | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('backtest_jobs')
    .insert({
      user_id: user.id,
      status: 'pending',
      asset_class: 'stock',
      initial_capital_usd: 100000,
      rebalance_frequency: 'monthly',
      benchmark_symbol: 'SPY',
      metadata: {},
      ...payload,
    })
    .select()
    .single()

  revalidatePath('/backtests')
  return data
}

export async function deleteBacktestJob(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('backtest_jobs')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  revalidatePath('/backtests')
}
