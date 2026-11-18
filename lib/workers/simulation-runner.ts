/**
 * Simulation-job runner — the /api/simulations POST body after its ownership
 * check, as a direct-call function (Phase 1.2). The route verifies the caller
 * owns the job and then calls this; the cron processes pending jobs directly
 * with the admin client. Either way the job ends 'completed' or 'failed' —
 * never silently stuck in 'running'.
 */

import type { createAdminClient } from '@/lib/supabase/admin'
import { simulateWithClaude } from '@/lib/agents/mirofish-client'
import type { TradeContext } from '@/lib/agents/types'

type AdminClient = ReturnType<typeof createAdminClient>

export type SimulationJobResult =
  | { ok: true; job_id: string; report_id: string; alreadyCompleted?: boolean }
  | { ok: false; job_id: string; error: string }

export async function runSimulationJob(
  adminSupabase: AdminClient,
  jobId: string
): Promise<SimulationJobResult> {
  const { data: job, error: jobErr } = await adminSupabase
    .from('simulation_jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (jobErr || !job) return { ok: false, job_id: jobId, error: 'Job not found' }
  if (job.status === 'completed') return { ok: true, job_id: jobId, report_id: '', alreadyCompleted: true }

  // Mark as running
  await adminSupabase
    .from('simulation_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', jobId)

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
        job_id: jobId,
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
      .eq('id', jobId)

    // Fire alert
    await adminSupabase.from('alerts').insert({
      user_id: job.user_id,
      type: 'simulation_done',
      title: `Simulation complete: ${job.title}`,
      body: `${report.consensusDirection} outlook — ${Math.round(report.bullProbability * 100)}% bull / ${Math.round(report.bearProbability * 100)}% bear`,
      severity: 'info',
      is_read: false,
      metadata: { job_id: jobId, report_id: savedReport.id },
    })

    return { ok: true, job_id: jobId, report_id: savedReport.id }
  } catch (err) {
    await adminSupabase
      .from('simulation_jobs')
      .update({ status: 'failed' })
      .eq('id', jobId)

    return { ok: false, job_id: jobId, error: err instanceof Error ? err.message : 'Simulation failed' }
  }
}
