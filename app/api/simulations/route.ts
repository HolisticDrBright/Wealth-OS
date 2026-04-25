import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { apiSuccess, apiError } from '@/lib/api'
import { simulateWithClaude } from '@/lib/agents/mirofish-client'
import type { TradeContext } from '@/lib/agents/types'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError('Unauthorized', 401)

  const body = await req.json().catch(() => ({}))
  const { job_id } = body

  if (!job_id) return apiError('job_id required', 400)

  const adminSupabase = createAdminClient()

  // Fetch job and verify ownership
  const { data: job, error: jobErr } = await adminSupabase
    .from('simulation_jobs')
    .select('*')
    .eq('id', job_id)
    .eq('user_id', user.id)
    .single()

  if (jobErr || !job) return apiError('Job not found', 404)
  if (job.status === 'completed') return apiSuccess({ message: 'Already completed' })

  // Mark as running
  await adminSupabase
    .from('simulation_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', job_id)

  try {
    const symbols: string[] = job.symbols ?? []
    const primarySymbol = symbols[0] ?? 'SPY'

    // Build a trade context for simulation
    const context: TradeContext = {
      trade: {
        symbol: primarySymbol,
        action: 'buy',
        asset_class: (job.asset_class ?? 'stock') as TradeContext['trade']['asset_class'],
        notional_value: 10000,
        trader_name: 'Simulation',
        trader_handle: 'simulation',
        trader_return_pct: 0,
        trader_win_rate: 0,
      },
      user: {
        id: job.user_id,
        total_net_worth: 100000,
        portfolio: [],
      },
    }

    // Run simulation using MiroFish client (with Claude fallback)
    const report = await simulateWithClaude(context)

    // Persist report
    const { data: savedReport, error: reportErr } = await adminSupabase
      .from('simulation_reports')
      .insert({
        job_id,
        user_id: job.user_id,
        bull_probability: report.bullProbability,
        bear_probability: report.bearProbability,
        consensus_direction: report.consensusDirection,
        tail_risk_score: report.tailRiskScore,
        confidence_level: report.confidenceLevel,
        agent_consensus: report.agentConsensus,
        key_findings: report.keyFindings,
        scenario_summary: report.scenarioSummary,
        raw_output: report as unknown as Record<string, unknown>,
      })
      .select()
      .single()

    if (reportErr) throw new Error(reportErr.message)

    // Mark job completed
    await adminSupabase
      .from('simulation_jobs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', job_id)

    // Fire alert
    await adminSupabase.from('alerts').insert({
      user_id: job.user_id,
      type: 'simulation_done',
      title: `Simulation complete: ${job.title}`,
      body: `${report.consensusDirection} outlook — ${Math.round(report.bullProbability * 100)}% bull / ${Math.round(report.bearProbability * 100)}% bear`,
      severity: 'info',
      is_read: false,
      metadata: { job_id, report_id: savedReport.id },
    })

    return apiSuccess({ job_id, report_id: savedReport.id, report })
  } catch (err) {
    await adminSupabase
      .from('simulation_jobs')
      .update({ status: 'failed' })
      .eq('id', job_id)

    return apiError(err instanceof Error ? err.message : 'Simulation failed', 500)
  }
}
