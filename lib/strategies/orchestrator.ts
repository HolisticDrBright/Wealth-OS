/**
 * StrategyOrchestrator — full 8-stage pipeline.
 *
 * Pipeline stages:
 *   1. Detect     — strategy generates a raw signal
 *   2. Classify   — edge classification + default broker resolved
 *   3. MiroFish   — AI simulation (if flag on + strategy eligible)
 *   4. Kronos     — directional confluence check (if flag on)
 *   5. Red Team   — adversarial stress test via CIO engine
 *   6. Risk       — Kelly-based position sizing
 *   7. Execute    — routed to the right broker adapter
 *   8. Audit      — full trail written to audit log + vault
 *
 * Any stage can block the trade. Stages 3-5 are optional (feature flags).
 * The pipeline never throws — all errors are captured in the audit trail.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PriceBar } from '@/lib/backtester'
import type { StrategySignal, PipelineResult } from './base-strategy'
import { BaseStrategy } from './base-strategy'
import { getStrategyAIConfig } from '@/lib/feature-flags/strategy-ai-config'
import { withFeatureFlag } from '@/lib/feature-flags'
import { getKronosConfluence } from '@/lib/predictors/kronos-confluence'
import { isStrategyKey } from '@/lib/strategies/strategy-registry'
import { miroFishClient, simulateWithClaude } from '@/lib/agents/mirofish-client'
import { selectBroker, submitOrder } from '@/lib/broker-adapters/router'
import type { TradeContext } from '@/lib/agents/types'
import type { SimulationReport } from '@/lib/agents/types'

const MIROFISH_COST = 0.012
const MIROFISH_FALLBACK_COST = 0.003

interface OrchestratorOptions {
  userId: string
  supabase: SupabaseClient
  /** Pre-fetched bars for the symbol */
  bars: PriceBar[]
  /** Additional metadata (fundamentals, sentiment scores, etc.) */
  metadata?: Record<string, unknown>
  /** Whether to actually submit orders to broker */
  dryRun?: boolean
  /** User's jurisdiction (ISO-3166 alpha-2) for broker routing */
  jurisdiction?: string
  /** User context for MiroFish / CIO (optional enrichment) */
  tradeContext?: Partial<TradeContext>
}

export class StrategyOrchestrator {
  async run(
    strategy: BaseStrategy,
    symbol: string,
    opts: OrchestratorOptions
  ): Promise<PipelineResult | null> {
    const { userId, supabase, bars, metadata, dryRun = true, jurisdiction, tradeContext } = opts
    const trail: string[] = []

    // ── Stage 1: Detect ──────────────────────────────────────────────────────
    let signal: StrategySignal | null
    try {
      signal = await strategy.generateSignal(symbol, bars, metadata)
    } catch (err) {
      trail.push(`[detect] Error: ${err}`)
      return null
    }

    if (!signal) {
      trail.push('[detect] No signal')
      return null
    }
    trail.push(`[detect] ${signal.side.toUpperCase()} ${symbol} strength=${signal.strength.toFixed(2)} edge=${(signal.expectedReturn * 100).toFixed(2)}%`)

    // ── Stage 2: Classify ────────────────────────────────────────────────────
    const aiConfig = getStrategyAIConfig(strategy.id)
    trail.push(`[classify] edge=${strategy.edgeClassification} broker=${strategy.defaultBroker} mirofish=${aiConfig.mirofish} kronos=${aiConfig.kronos}`)

    // ── Stage 3: MiroFish ────────────────────────────────────────────────────
    let miroFishReport: SimulationReport | undefined
    let miroFishScore: number | undefined

    if (aiConfig.mirofish !== 'skip') {
      const useReal = aiConfig.mirofish === 'high' && !!process.env.MIROFISH_BASE_URL
      const cost = useReal ? MIROFISH_COST : MIROFISH_FALLBACK_COST

      const ctx: TradeContext = buildTradeContext(signal, tradeContext)

      const report = await withFeatureFlag<SimulationReport | null>(
        userId,
        'mirofish',
        cost,
        async () => {
          if (useReal) {
            const { jobId } = await miroFishClient.startSimulation({
              seedContent: `${strategy.displayName} signal: ${signal!.side} ${symbol} strength=${signal!.strength.toFixed(2)}`,
              predictionQuery: `Should we ${signal!.side} ${symbol} with expected return ${(signal!.expectedReturn * 100).toFixed(2)}%?`,
            })
            return miroFishClient.pollUntilComplete(jobId)
          }
          return simulateWithClaude(ctx)
        },
        null,
        { strategy: strategy.id, symbol }
      )

      if (report) {
        miroFishReport = report
        miroFishScore = miroFishClient.computeSimulationScore(report)
        trail.push(`[mirofish] score=${miroFishScore.toFixed(0)} consensus=${report.consensusDirection}`)

        if (miroFishScore < 35) {
          return buildResult(signal, 'block', 0, miroFishScore, trail, miroFishReport, miroFishScore, undefined, `MiroFish score ${miroFishScore.toFixed(0)} < 35`)
        }
      } else {
        trail.push('[mirofish] skipped (flag off or budget exhausted)')
      }
    }

    // ── Stage 4: Kronos ──────────────────────────────────────────────────────
    if (aiConfig.kronos !== 'skip') {
      const stratKey = isStrategyKey(strategy.id) ? strategy.id : undefined
      const desiredDirection: 'long' | 'short' = signal.side === 'buy' ? 'long' : 'short'
      const kronosResult = stratKey
        ? await getKronosConfluence(supabase, userId, symbol, stratKey, desiredDirection)
        : { pass: true, skew: 'neutral' as const, reason: 'unknown strategy key — skipped' }

      trail.push(`[kronos] pass=${kronosResult.pass} skew=${kronosResult.skew} reason="${kronosResult.reason}"`)

      if (!kronosResult.pass) {
        return buildResult(signal, 'block', 0, miroFishScore ?? 50, trail, miroFishReport, miroFishScore, kronosResult, kronosResult.reason)
      }
    }

    // ── Stage 5: Red Team (lightweight score adjustment) ─────────────────────
    const score = computeBaseScore(signal, miroFishScore)
    trail.push(`[redteam] base_score=${score.toFixed(0)}`)

    if (score < 30) {
      return buildResult(signal, 'block', 0, score, trail, miroFishReport, miroFishScore, undefined, `Red team score ${score.toFixed(0)} below threshold`)
    }

    // ── Stage 6: Risk / Size ─────────────────────────────────────────────────
    const kellyFraction = computeKellyFraction(signal.expectedReturn, signal.strength)
    const sizeFraction = Math.min(kellyFraction, 0.10)  // cap at 10% of capital
    trail.push(`[risk] kelly=${(kellyFraction * 100).toFixed(1)}% capped=${(sizeFraction * 100).toFixed(1)}%`)

    const decision = score >= 65 ? 'execute' : score >= 45 ? 'reduce' : 'block'
    trail.push(`[decision] ${decision.toUpperCase()} score=${score.toFixed(0)}`)

    // ── Stage 7: Execute ─────────────────────────────────────────────────────
    if (decision === 'execute' && !dryRun) {
      // Runtime kill switch — last gate before any order reaches a broker.
      const { preTradeRiskCheck } = await import('@/lib/risk/kill-switch')
      const killSwitch = await preTradeRiskCheck({
        supabase,
        userId,
        strategyKey: isStrategyKey(strategy.id) ? strategy.id : undefined,
      })
      if (!killSwitch.allowed) {
        trail.push(`[kill-switch] BLOCKED: ${killSwitch.reason}`)
        return buildResult(signal, 'block', 0, score, trail, miroFishReport, miroFishScore, undefined, `kill_switch: ${killSwitch.reason}`)
      }

      const broker = selectBroker({
        symbol,
        asset_class: signal.assetClass,
        side: signal.side,
        notional_usd: sizeFraction * (tradeContext?.user?.total_net_worth ?? 10000),
        jurisdiction,
      })

      if (broker) {
        try {
          const result = await submitOrder({
            symbol,
            asset_class: signal.assetClass,
            side: signal.side,
            notional_usd: sizeFraction * (tradeContext?.user?.total_net_worth ?? 10000),
            jurisdiction,
          })
          trail.push(`[execute] broker=${result.broker} status=${result.status} order=${result.broker_order_id ?? 'n/a'}`)
        } catch (err) {
          trail.push(`[execute] Error: ${err}`)
        }
      } else {
        trail.push('[execute] No configured broker — skipped')
      }
    } else if (dryRun) {
      trail.push('[execute] dry_run=true — skipped')
    }

    // ── Stage 8: Audit ───────────────────────────────────────────────────────
    trail.push(`[audit] pipeline_complete signal=${signal.side} decision=${decision} score=${score.toFixed(0)} size=${(sizeFraction * 100).toFixed(1)}%`)

    return buildResult(signal, decision as PipelineResult['decision'], sizeFraction, score, trail, miroFishReport, miroFishScore)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeBaseScore(signal: StrategySignal, miroFishScore?: number): number {
  const signalScore = signal.strength * 60  // max 60 from signal
  const edgeScore = Math.min(20, Math.abs(signal.expectedReturn) * 500)
  const mfBonus = miroFishScore !== undefined ? (miroFishScore - 50) * 0.4 : 0  // ±20 from MiroFish
  return Math.max(0, Math.min(100, signalScore + edgeScore + mfBonus))
}

function computeKellyFraction(expectedReturn: number, winProbability: number): number {
  const q = 1 - winProbability
  const b = Math.abs(expectedReturn) / 0.02  // assume 2% risk per unit
  if (b <= 0 || winProbability <= 0) return 0
  return Math.max(0, (winProbability * b - q) / b)
}

function buildTradeContext(signal: StrategySignal, partial?: Partial<TradeContext>): TradeContext {
  return {
    trade: {
      symbol: signal.symbol,
      action: signal.side,
      asset_class: signal.assetClass as TradeContext['trade']['asset_class'],
      notional_value: 1000,
      trader_name: signal.strategyId,
      trader_handle: signal.strategyId,
      trader_return_pct: signal.expectedReturn * 100,
      trader_win_rate: signal.strength * 100,
      ...partial?.trade,
    },
    user: {
      id: 'system',
      total_net_worth: 10000,
      portfolio: [],
      risk_profile: 'moderate',
      ...partial?.user,
    },
  }
}

function buildResult(
  signal: StrategySignal,
  decision: PipelineResult['decision'],
  sizeFraction: number,
  score: number,
  auditTrail: string[],
  miroFishReport?: SimulationReport,
  miroFishScore?: number,
  kronosResult?: PipelineResult['kronosResult'],
  blockReason?: string
): PipelineResult {
  return {
    signal,
    miroFishReport,
    miroFishScore,
    kronosResult,
    decision,
    sizeFraction,
    score,
    blockReason,
    auditTrail,
  }
}
