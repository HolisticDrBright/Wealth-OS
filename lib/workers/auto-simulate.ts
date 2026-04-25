/**
 * Auto-simulate worker.
 *
 * Intended to be called:
 *   - From app/api/execute-copy-trades/route.ts after a position is created
 *   - From app/api/simulations/manual/route.ts for on-demand user requests
 *
 * Decision flow:
 *   1. Look up STRATEGY_REGISTRY_CONFIG[strategyKey].mirofish
 *   2. 'skip'   → return immediately (not eligible)
 *   3. 'medium' → only proceed if regime warrants it (see shouldRunMedium)
 *   4. 'high'|'medium' → canSpend gate → run simulation → logUsage (fire-and-forget)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { FeatureFlagService } from '@/lib/feature-flags/FeatureFlagService'
import { MiroFishClient, simulateWithClaude } from '@/lib/agents/mirofish-client'
import {
  STRATEGY_REGISTRY_CONFIG,
  type StrategyKey,
} from '@/lib/strategies/strategy-registry'
import type { SimulationReport, TradeContext } from '@/lib/agents/types'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Estimated cost per full MiroFish multi-agent simulation in cents. */
const MIROFISH_HIGH_ESTIMATE_CENTS = 200   // ~$2.00 for real API
const MIROFISH_MEDIUM_ESTIMATE_CENTS = 50  // ~$0.50 for Claude fallback

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Regime flags passed by the caller. Used to conditionally run medium-tier
 * strategies only when their defining market event is occurring.
 */
export interface SimulationRegime {
  isFomcDay?: boolean
  isPostEarnings?: boolean
  isPostDistribution?: boolean
  isCyclePeak?: boolean
  isDepegEvent?: boolean
  isLiquidationCascade?: boolean
  isPostTge?: boolean
  isRiskOffUnwind?: boolean
  isExtremePositioning?: boolean
  isDealerReaction?: boolean
}

export interface AutoSimulateJob {
  tradeId: string
  userId: string
  strategyKey: StrategyKey
  /** Seed content for the MiroFish simulation prompt. */
  seedContent?: string
  predictionQuery?: string
  regime?: SimulationRegime
  /** Forwarded to logUsage for audit trail. */
  tradeContext?: Pick<TradeContext['trade'], 'symbol' | 'asset_class'>
}

export interface AutoSimulateResult {
  skipped: boolean
  reason?: string
  report?: SimulationReport
  score?: number
  costCents: number
}

// ─── Regime gate for medium-tier strategies ───────────────────────────────────

/**
 * Returns true when the current regime warrants running a medium-tier strategy.
 * High-tier strategies always run (when the flag allows).
 */
export function shouldRunMedium(key: StrategyKey, regime: SimulationRegime): boolean {
  switch (key) {
    case 'sector_rotation':       return regime.isFomcDay ?? false
    case 'spinoff':               return regime.isPostDistribution ?? false
    case 'dca_halving':           return regime.isCyclePeak ?? false
    case 'defi_yield':            return regime.isDepegEvent ?? false
    case 'liquidation_hunting':   return regime.isLiquidationCascade ?? false
    case 'airdrop_farming':       return regime.isPostTge ?? false
    case 'carry_trade':           return regime.isRiskOffUnwind ?? false
    case 'cot_positioning':       return regime.isExtremePositioning ?? false
    case 'gamma_exposure':        return regime.isDealerReaction ?? false
    // These medium strategies run whenever enabled (no single regime trigger)
    case 'onchain_signal':        return true
    case 'autopilot_congressional': return true
    default:                      return true
  }
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export async function runAutoSimulate(
  supabase: SupabaseClient,
  job: AutoSimulateJob
): Promise<AutoSimulateResult> {
  const cfg = STRATEGY_REGISTRY_CONFIG[job.strategyKey]
  const svc = new FeatureFlagService(supabase)

  // ── Step 1: strategy eligibility ─────────────────────────────────────────
  if (cfg.mirofish === 'skip') {
    console.info(`[auto-simulate] mirofish skipped (strategy not eligible): ${job.strategyKey}`)
    return { skipped: true, reason: 'strategy_not_eligible', costCents: 0 }
  }

  // ── Step 2: regime gate for medium strategies ─────────────────────────────
  if (cfg.mirofish === 'medium') {
    const regime = job.regime ?? {}
    if (!shouldRunMedium(job.strategyKey, regime)) {
      console.info(`[auto-simulate] mirofish skipped (regime not active): ${job.strategyKey}`)
      return { skipped: true, reason: 'regime_not_active', costCents: 0 }
    }
  }

  // ── Step 3: feature-flag budget gate ─────────────────────────────────────
  const estimatedCents = cfg.mirofish === 'high'
    ? MIROFISH_HIGH_ESTIMATE_CENTS
    : MIROFISH_MEDIUM_ESTIMATE_CENTS

  const gate = await svc.canSpend(job.userId, 'mirofish', estimatedCents)
  if (!gate.allowed) {
    console.info(`[auto-simulate] mirofish skipped (flag off or budget exceeded): ${gate.reason}`)
    return { skipped: true, reason: gate.reason, costCents: 0 }
  }

  // ── Step 4: run simulation ────────────────────────────────────────────────
  const startMs = Date.now()
  let report: SimulationReport
  let actualCostCents: number
  let score: number

  try {
    if (cfg.mirofish === 'high' && process.env.MIROFISH_BASE_URL) {
      const client = new MiroFishClient()
      const { jobId } = await client.startSimulation({
        seedContent: job.seedContent ?? `Trade: ${job.tradeContext?.symbol ?? 'unknown'} on ${job.tradeContext?.asset_class ?? 'unknown'}`,
        predictionQuery: job.predictionQuery ?? `What is the probability this trade is profitable?`,
      })
      report = await client.pollUntilComplete(jobId)
      score = client.computeSimulationScore(report)
      actualCostCents = MIROFISH_HIGH_ESTIMATE_CENTS
    } else {
      // Claude fallback — used for medium tier and when MiroFish isn't deployed
      const context: TradeContext = {
        trade: {
          symbol: job.tradeContext?.symbol ?? 'unknown',
          action: 'buy',
          asset_class: job.tradeContext?.asset_class ?? 'stock',
          notional_value: 0,
          trader_name: 'auto-simulate',
          trader_handle: '',
          trader_return_pct: 0,
          trader_win_rate: 0,
        },
        user: {
          id: job.userId,
          total_net_worth: 0,
          portfolio: [],
        },
      }
      report = await simulateWithClaude(context)
      // Score inline without a second MiroFishClient instantiation
      const bullScore = report.bullProbability * 100 * 0.30
      const consensusScore = report.agentConsensus * 100 * 0.40
      const tailDiscount = (1 - report.tailRiskScore / 100) * 100 * 0.20
      const confMap = { high: 100, medium: 60, low: 20 }
      const confScore = confMap[report.confidenceLevel] * 0.10
      const raw = consensusScore + bullScore + tailDiscount + confScore
      score = report.confidenceLevel === 'low' ? Math.min(60, raw) : Math.min(100, raw)
      actualCostCents = MIROFISH_MEDIUM_ESTIMATE_CENTS
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.warn(`[auto-simulate] simulation failed: ${errMsg}`)

    // Log a minimal failure cost so budget tracking stays honest
    svc.logUsage({
      userId: job.userId,
      featureKey: 'mirofish',
      operation: `auto_simulate:error:${job.strategyKey}`,
      costCents: 1,
      latencyMs: Date.now() - startMs,
      tradeId: job.tradeId,
      metadata: { error: errMsg, strategyKey: job.strategyKey },
    }).catch(() => {})

    return { skipped: true, reason: `simulation_error: ${errMsg}`, costCents: 1 }
  }

  const latencyMs = Date.now() - startMs

  // ── Step 5: log actual usage (fire-and-forget) ────────────────────────────
  svc.logUsage({
    userId: job.userId,
    featureKey: 'mirofish',
    operation: `auto_simulate:${job.strategyKey}`,
    costCents: actualCostCents,
    latencyMs,
    tradeId: job.tradeId,
    metadata: {
      strategyKey: job.strategyKey,
      tier: cfg.mirofish,
      consensusDirection: report.consensusDirection,
      tailRiskScore: report.tailRiskScore,
    },
  }).catch(() => {})

  // Budget alert (fire-and-forget)
  svc.checkBudgetAlert(job.userId, 'mirofish').catch(() => {})

  // Persist simulation job record
  supabase.from('simulation_jobs').insert({
    user_id: job.userId,
    trade_id: job.tradeId,
    strategy_key: job.strategyKey,
    status: 'completed',
    report: report,
    cost_cents: actualCostCents,
    latency_ms: latencyMs,
  }).then(({ error }) => {
    if (error) console.warn('[auto-simulate] failed to persist job:', error.message)
  })

  return { skipped: false, report, score, costCents: actualCostCents }
}
