import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiSuccess, apiError } from '@/lib/api'
import { runBacktest, generateSyntheticBars } from '@/lib/backtester'
import type { BacktestJob } from '@/lib/types'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get('job_id')

  if (jobId) {
    const { data: job } = await supabase
      .from('backtest_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('user_id', user.id)
      .single()

    if (!job) return apiError('Job not found', 404)

    const { data: result } = await supabase
      .from('backtest_results')
      .select('*')
      .eq('job_id', jobId)
      .single()

    return apiSuccess({ job, result })
  }

  const { data } = await supabase
    .from('backtest_jobs')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  return apiSuccess(data ?? [], { count: data?.length ?? 0 })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const body = await req.json()
  const {
    name, description, symbols, asset_class = 'stock',
    start_date, end_date, initial_capital_usd = 100000,
    rebalance_frequency = 'monthly', benchmark_symbol = 'SPY',
    strategy_id,
  } = body

  if (!name?.trim()) return apiError('name is required')
  if (!symbols?.length) return apiError('symbols array is required')
  if (!start_date || !end_date) return apiError('start_date and end_date are required')

  const admin = createAdminClient()

  // Create job record
  const { data: job, error: jobErr } = await admin
    .from('backtest_jobs')
    .insert({
      user_id: user.id,
      name: name.trim(),
      description: description ?? null,
      symbols,
      asset_class,
      start_date,
      end_date,
      initial_capital_usd,
      rebalance_frequency,
      benchmark_symbol,
      strategy_id: strategy_id ?? null,
      status: 'running',
      started_at: new Date().toISOString(),
      metadata: {},
    })
    .select()
    .single()

  if (jobErr || !job) return apiError(jobErr?.message ?? 'Failed to create job', 500)

  // Run backtest synchronously (in production move to background worker)
  try {
    // Generate synthetic bars for all symbols + benchmark
    const allSymbols = [...new Set([...symbols, benchmark_symbol])]
    const bars = allSymbols.flatMap(sym => generateSyntheticBars(sym, start_date, end_date))

    const typedJob: BacktestJob = {
      ...job,
      rebalance_frequency: job.rebalance_frequency as BacktestJob['rebalance_frequency'],
      status: 'running',
      metadata: {},
    }

    const { result, error: btError } = await runBacktest({ job: typedJob, bars })

    if (btError) {
      await admin.from('backtest_jobs')
        .update({ status: 'failed', error_message: btError, completed_at: new Date().toISOString() })
        .eq('id', job.id)
      return apiError(btError, 500)
    }

    // Save result
    const { data: savedResult } = await admin
      .from('backtest_results')
      .insert({ ...result, id: undefined })
      .select()
      .single()

    // Update job to completed
    await admin.from('backtest_jobs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', job.id)

    return apiSuccess({ job: { ...job, status: 'completed' }, result: savedResult })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await admin.from('backtest_jobs')
      .update({ status: 'failed', error_message: msg, completed_at: new Date().toISOString() })
      .eq('id', job.id)
    return apiError(msg, 500)
  }
}
