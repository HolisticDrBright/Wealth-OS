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
import { loadUserProfile, getEffectiveStrategies } from '@/lib/strategies/profile-params'
import { STRATEGY_REGISTRY_CONFIG } from '@/lib/strategies/strategy-registry'
import type { StrategyKey } from '@/lib/strategies/strategy-registry'
import { runPaperTradingPass } from '@/lib/paper-trading/PaperTradeRunner'

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
  const paperTrading = await runScheduledPaperTradingPasses(supabase)

  // Fetch enabled strategies per user to avoid running signals nobody wants
  const { data: enabledRows } = await supabase
    .from('user_enabled_strategies')
    .select('user_id, strategy_key')
    .eq('is_enabled', true)

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
    // Maturity gate — stub and retired strategies must never execute
    const registryConfig = STRATEGY_REGISTRY_CONFIG[strategy.key as StrategyKey]
    if (registryConfig) {
      const { maturityStatus } = registryConfig
      if (maturityStatus === 'stub' || maturityStatus === 'retired') {
        console.warn(`[scan-all] Skipping ${strategy.key}: maturityStatus=${maturityStatus}`)
        continue
      }
    }

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

    // Cache profiles for this scan run (one DB round-trip per user, not per opportunity)
    const profileCache = new Map<string, Set<StrategyKey>>()
    const getEffective = async (uid: string): Promise<Set<StrategyKey>> => {
      if (profileCache.has(uid)) return profileCache.get(uid)!
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const up = await loadUserProfile(supabase as any, uid)
      const eff = getEffectiveStrategies(up)
      profileCache.set(uid, eff)
      return eff
    }

    for (const opp of opportunities) {
      for (const userId of userIds) {
        try {
          // Profile gate — skip if this strategy is not in the user's effective set
          const effective = await getEffective(userId)
          if (!effective.has(strategy.key as StrategyKey)) {
            blocked++
            continue
          }

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

          // userId MUST be attributed — user-scoped audit rows feed the paper
          // scorecards (blocked/veto counts); an unattributed row is invisible.
          await strategy.logAudit(opp, { action: execResult.status === 'submitted' ? 'execute' : 'block' }, verdicts, supabase, userId)

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
    paper_trading: paperTrading,
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

async function runScheduledPaperTradingPasses(
  supabase: ReturnType<typeof createAdminClient>
): Promise<{
  users: number
  positionsOpened: number
  positionsClosed: number
  errors: number
  skipped: number
}> {
  const { data: rows, error } = await supabase
    .from('user_enabled_strategies')
    .select('user_id, strategy_key')
    .eq('paper_enabled', true)

  if (error) {
    console.warn('[scan-all] paper trading lookup error:', error.message)
    return { users: 0, positionsOpened: 0, positionsClosed: 0, errors: 1, skipped: 0 }
  }

  const byUser = new Map<string, string[]>()
  for (const row of rows ?? []) {
    const uid = row.user_id as string
    if (!byUser.has(uid)) byUser.set(uid, [])
    byUser.get(uid)!.push(row.strategy_key as string)
  }

  if (byUser.size === 0) {
    return { users: 0, positionsOpened: 0, positionsClosed: 0, errors: 0, skipped: 0 }
  }

  const results = await Promise.allSettled(
    [...byUser.entries()].map(([userId, enabledKeys]) =>
      runPaperTradingPass(userId, supabase, enabledKeys)
    )
  )

  return results.reduce(
    (acc, result) => {
      if (result.status === 'rejected') {
        acc.errors++
        return acc
      }

      acc.positionsOpened += result.value.positionsOpened
      acc.positionsClosed += result.value.positionsClosed
      acc.errors += result.value.errors.length
      acc.skipped += Object.values(result.value.skipped ?? {}).reduce(
        (sum, count) => sum + count,
        0
      )
      return acc
    },
    { users: byUser.size, positionsOpened: 0, positionsClosed: 0, errors: 0, skipped: 0 }
  )
}
