/**
 * POST /api/internal/scan-all
 *
 * Internal endpoint triggered every 15 minutes by:
 *   - .github/workflows/scheduled-scan.yml (GitHub Actions)
 *   - deploy/systemd/wealth-os-scan.timer (Hetzner VPS)
 *
 * Auth: Bearer token via WEALTH_OS_API_KEY env var.
 *
 * For each enabled strategy, runs detectOpportunities() then routes each
 * opportunity through the full pipeline (edge -> mirofish -> kronos -> risk ->
 * size -> execute). Returns counts per strategy for monitoring.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAllPipelineStrategies } from '@/lib/strategies/all-pipeline-strategies'
import type { OpportunityContext } from '@/lib/strategies/pipeline-types'

// ─── Auth ─────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  const apiKey = process.env.WEALTH_OS_API_KEY
  if (!apiKey) return false  // key not set -> deny all
  const bearer = req.headers.get('authorization')?.replace('Bearer ', '').trim()
  return bearer === apiKey
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const strategies = getAllPipelineStrategies()

  // Fetch enabled strategies per user to avoid running signals nobody wants
  const { data: enabledRows } = await supabase
    .from('user_enabled_strategies')
    .select('user_id, strategy_key')
    .eq('enabled', true)

  const enabledByKey = new Map<string, string[]>()
  for (const row of enabledRows ?? []) {
    const key = row.strategy_key as string
    const uid = row.user_id as string
    if (!enabledByKey.has(key)) enabledByKey.set(key, [])
    enabledByKey.get(key)!.push(uid)
  }

  const results: Record<string, { opportunities: number; executed: number; blocked: number; errors: number }> = {}
  const startedAt = Date.now()

  for (const strategy of strategies) {
    const userIds = enabledByKey.get(strategy.key) ?? []
    if (userIds.length === 0) continue

    const ctx: OpportunityContext = { supabase }
    let opportunities: import('@/lib/strategies/pipeline-types').Opportunity[] = []

    try {
      opportunities = await strategy.detectWithConfluence(ctx)
    } catch (err) {
      console.error(`[scan-all] ${strategy.key} detectOpportunities error:`, err)
      results[strategy.key] = { opportunities: 0, executed: 0, blocked: 0, errors: 1 }
      continue
    }

    let executed = 0
    let blocked = 0
    let errors = 0

    for (const opp of opportunities) {
      for (const userId of userIds) {
        try {
          // Run the standard pipeline stages for this user
          const [edge, mf, kronos, redTeam, risk] = await Promise.allSettled([
            strategy.classifyEdge(opp),
            strategy.runMiroFishConfluence(opp, userId, supabase),
            strategy.runKronosConfluence(opp, userId, supabase),
            strategy.runRedTeam(opp),
            strategy.runRiskCheck(opp, userId, supabase),
          ])

          const edgeResult = edge.status === 'fulfilled' ? edge.value : null
          const mfResult   = mf.status  === 'fulfilled' ? mf.value  : null
          const kronResult = kronos.status === 'fulfilled' ? kronos.value : null
          const rtResult   = redTeam.status === 'fulfilled' ? redTeam.value : { passed: false, score: 0 }
          const riskResult = risk.status === 'fulfilled' ? risk.value : { veto: true, kellyFraction: 0 }

          void edgeResult  // classified but not used for gate here; logged in audit

          const verdicts = {
            mirofish: mfResult ?? null,
            kronos: kronResult ?? null,
            redTeam: rtResult,
            risk: riskResult,
          }

          if (riskResult.veto || !rtResult.passed) {
            blocked++
            continue
          }

          if (kronResult && !kronResult.pass) {
            blocked++
            continue
          }

          const size = await strategy.sizePosition(opp, verdicts, userId, supabase)
          const execResult = await strategy.execute(opp, size, userId, supabase, undefined)

          await strategy.logAudit(opp, { action: execResult.status === 'submitted' ? 'execute' : 'block' }, verdicts, supabase)

          if (execResult.status === 'submitted') executed++
          else blocked++
        } catch (err) {
          console.error(`[scan-all] ${strategy.key}/${userId} execution error:`, err)
          errors++
        }
      }
    }

    results[strategy.key] = { opportunities: opportunities.length, executed, blocked, errors }
  }

  const elapsed = Date.now() - startedAt

  return NextResponse.json({
    ok: true,
    elapsed_ms: elapsed,
    strategies_scanned: Object.keys(results).length,
    results,
  })
}

// Allow GET for health checks from GitHub Actions
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, status: 'scan-all endpoint healthy' })
}
