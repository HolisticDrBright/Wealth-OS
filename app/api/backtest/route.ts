import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiSuccess, apiError } from '@/lib/api'
import { runBacktest } from '@/lib/backtester'
import { runWalkForward, runMonteCarlo, type WalkForwardConfig } from '@/lib/backtester-advanced'
import { computePortfolioReturns } from '@/lib/risk-engine'
import { getBarsForSymbols } from '@/lib/market-data'
import { logAudit } from '@/lib/audit-log'
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

  const body = await req.json().catch(() => ({}))
  const {
    name, description, symbols, asset_class = 'stock',
    start_date, end_date, initial_capital_usd = 100000,
    rebalance_frequency = 'monthly', benchmark_symbol = 'SPY',
    strategy_id,
    run_walk_forward = false,
    run_monte_carlo = false,
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
    // Fetch real OHLCV bars (Alpaca → Yahoo → synthetic fallback)
    const allSymbols = [...new Set([...symbols, benchmark_symbol])]
    const bars = await getBarsForSymbols(allSymbols, start_date, end_date)

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

    // Optional: walk-forward analysis
    let walkForwardOutput = null
    if (run_walk_forward) {
      const wfConfig: WalkForwardConfig = { job: typedJob, bars }
      walkForwardOutput = await runWalkForward(wfConfig).catch(() => null)
    }

    // Optional: Monte Carlo simulation
    let monteCarloOutput = null
    if (run_monte_carlo && result.equity_curve?.length > 20) {
      const weightMap = new Map<string, number>(symbols.map((s: string) => [s, 1 / symbols.length]))
      const portReturns = computePortfolioReturns(bars, weightMap)
      if (portReturns.length > 20) {
        monteCarloOutput = runMonteCarlo({
          portfolioReturns: portReturns,
          initialValue: initial_capital_usd,
          horizonDays: 252,
          simulations: 1000,
        })
      }
    }

    await logAudit({
      user_id: user.id,
      action: 'strategy.created',
      resource: 'backtest_job',
      resource_id: job.id,
      metadata: { symbols, start_date, end_date, strategy: rebalance_frequency },
    })

    return apiSuccess({
      job: { ...job, status: 'completed' },
      result: savedResult,
      walkForward: walkForwardOutput,
      monteCarlo: monteCarloOutput,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await admin.from('backtest_jobs')
      .update({ status: 'failed', error_message: msg, completed_at: new Date().toISOString() })
      .eq('id', job.id)
    return apiError(msg, 500)
  }
}
