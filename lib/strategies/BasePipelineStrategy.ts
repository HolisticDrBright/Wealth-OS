/**
 * BasePipelineStrategy — abstract superclass for all 39 typed strategy
 * implementations. Provides default pipeline stage implementations that
 * subclasses can override when they need custom behaviour.
 *
 * Pipeline stages (in order):
 *   detectOpportunities → classifyEdge → runMiroFishConfluence →
 *   runKronosConfluence → runRedTeam → runRiskCheck →
 *   sizePosition → execute → logAudit
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { FeatureFlagService } from '@/lib/feature-flags/FeatureFlagService'
import { MiroFishClient, simulateWithClaude } from '@/lib/agents/mirofish-client'
import { getKronosConfluence } from '@/lib/predictors/kronos-confluence'
import {
  selectBroker,
  type AssetClass as BrokerAssetClass,
  type Jurisdiction,
} from '@/lib/brokers/asset-broker-routing'
import { getBroker, type BrokerCache } from '@/lib/brokers/BrokerFactory'
import type { BracketParams } from '@/lib/broker-adapters/types'
import {
  getStrategyConfig,
  type StrategyKey,
  type AssetClass,
  type StrategyAIConfig,
} from './strategy-registry'
import { resolveAndFetchImbalance, type ImbalanceVerdict } from '@/lib/confluence/order-book-imbalance'
import type {
  Opportunity,
  OpportunityContext,
  PipelineEdgeClassification,
  MiroFishVerdict,
  KronosVerdict,
  RedTeamVerdict,
  RiskVerdict,
  AllVerdicts,
  PositionSize,
  ExecutionResult,
  Decision,
  OpenPosition,
  PriceTick,
  ManageAction,
} from './pipeline-types'
import type { TradeContext } from '@/lib/agents/types'

// ─── Asset-class mapping ────────────────────────────────────────────────────────

function toBrokerAssetClass(ac: AssetClass): BrokerAssetClass {
  switch (ac) {
    case 'stocks':     return 'stocks'
    case 'options':    return 'options'
    case 'crypto':     return 'crypto_spot'
    case 'forex':      return 'forex'
    case 'polymarket': return 'polymarket'
    case 'multi-asset': return 'stocks'
  }
}

// ─── Abstract base ─────────────────────────────────────────────────────────────

export abstract class BasePipelineStrategy {
  abstract readonly key: StrategyKey
  abstract readonly displayName: string
  /** Strategy-registry asset class (not broker-routing asset class). */
  abstract readonly assetClass: AssetClass

  get config(): StrategyAIConfig {
    return getStrategyConfig(this.key)
  }

  // ── Stage 1: Detect ──────────────────────────────────────────────────────────

  /** Return an empty array by default; subclasses override with real signal logic. */
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    return []
  }

  /**
   * Wrapper around detectOpportunities() that auto-registers every opportunity
   * into the ConfluenceRegistry. Use this instead of detectOpportunities() in
   * the scan-all runner so signals are available for cross-strategy consensus.
   */
  async detectWithConfluence(ctx: OpportunityContext): Promise<Opportunity[]> {
    const opps = await this.detectOpportunities(ctx)
    if (opps.length === 0) return opps

    const { confluenceRegistry } = await import('@/lib/strategies/confluence-registry')
    for (const opp of opps) {
      confluenceRegistry.register({
        fromStrategyKey: this.key,
        symbol: opp.symbol,
        direction: opp.direction === 'neutral' ? 'neutral' : opp.direction,
        strength: opp.strength,
        reasoning: (opp.metadata?.reasoning as string | undefined),
        timestamp: Date.now(),
      })
      if (ctx.supabase) {
        confluenceRegistry.persistSignal(
          {
            fromStrategyKey: this.key,
            symbol: opp.symbol,
            direction: opp.direction === 'neutral' ? 'neutral' : opp.direction,
            strength: opp.strength,
            reasoning: (opp.metadata?.reasoning as string | undefined),
            timestamp: Date.now(),
          },
          ctx.supabase
        )
      }
    }
    return opps
  }

  // ── Stage 2: Classify ────────────────────────────────────────────────────────

  async classifyEdge(opp: Opportunity): Promise<PipelineEdgeClassification> {
    return {
      edgeType: this.config.edgeType,
      confidence: opp.strength,
      rationale: `${this.config.edgeType} edge detected by ${this.key}`,
    }
  }

  // ── Stage 3: MiroFish ────────────────────────────────────────────────────────

  /**
   * Returns null when:
   *   - config.mirofish === 'skip' (strategy not eligible)
   *   - supabase unavailable
   *   - user flag disabled or budget exceeded
   */
  async runMiroFishConfluence(
    opp: Opportunity,
    userId: string,
    supabase?: SupabaseClient
  ): Promise<MiroFishVerdict | null> {
    if (this.config.mirofish === 'skip') return null
    if (!supabase) return null

    const svc = new FeatureFlagService(supabase)
    const useReal = this.config.mirofish === 'high' && !!process.env.MIROFISH_BASE_URL
    const costCents = useReal ? 12 : 3

    const gate = await svc.canSpend(userId, 'mirofish', costCents)
    if (!gate.allowed) return null

    const tradeCtx: TradeContext = {
      trade: {
        symbol: opp.symbol,
        action: opp.direction === 'long' ? 'buy' : 'sell',
        asset_class: opp.assetClass === 'polymarket' ? 'polymarket'
          : opp.assetClass === 'crypto' ? 'crypto'
          : opp.assetClass === 'forex' ? 'forex' : 'stock',
        notional_value: 1000,
        trader_name: this.key,
        trader_handle: this.key,
        trader_return_pct: opp.expectedReturn * 100,
        trader_win_rate: opp.strength * 100,
      },
      user: {
        id: userId,
        total_net_worth: 10000,
        portfolio: [],
        risk_profile: 'moderate',
      },
    }

    let report: import('@/lib/agents/types').SimulationReport
    if (useReal) {
      const client = new MiroFishClient()
      const { jobId } = await client.startSimulation({
        seedContent: `${this.key} signal: ${opp.direction} ${opp.symbol} strength=${opp.strength.toFixed(2)}`,
        predictionQuery: `Will ${opp.symbol} move ${opp.direction === 'long' ? 'up' : 'down'} based on ${this.config.edgeType} edge?`,
      })
      report = await client.pollUntilComplete(jobId)
      const score = client.computeSimulationScore(report)
      await svc.logUsage({ userId, featureKey: 'mirofish', operation: 'runMiroFishConfluence', costCents })
      return {
        scenario: report.consensusDirection === 'bullish' ? 'bull'
          : report.consensusDirection === 'bearish' ? 'bear' : 'neutral',
        score, report, costCents, used: true,
      }
    }

    // Claude fallback
    report = await simulateWithClaude(tradeCtx)
    const fallbackClient = new MiroFishClient()
    const score = fallbackClient.computeSimulationScore(report)
    await svc.logUsage({ userId, featureKey: 'mirofish', operation: 'runMiroFishConfluence', costCents })
    return {
      scenario: report.consensusDirection === 'bullish' ? 'bull'
        : report.consensusDirection === 'bearish' ? 'bear' : 'neutral',
      score, report, costCents, used: true,
    }
  }

  // ── Stage 4: Kronos ──────────────────────────────────────────────────────────

  /**
   * Returns null when config.kronos === 'skip' or supabase unavailable.
   * For 'high'-tier strategies, a bearish Kronos skew opposing a long blocks.
   * For 'medium', it warns only (pass=true).
   */
  async runKronosConfluence(
    opp: Opportunity,
    userId: string,
    supabase?: SupabaseClient
  ): Promise<KronosVerdict | null> {
    if (this.config.kronos === 'skip') return null
    if (!supabase) return null

    const result = await getKronosConfluence(
      supabase,
      userId,
      opp.symbol,
      opp.strategyKey,
      opp.direction === 'long' ? 'long' : 'short'
    )

    return {
      skew: result.skew,
      skewStrength: result.forecast?.skew_strength ?? 0,
      pass: result.pass,
      reason: result.reason,
      used: true,
    }
  }

  // ── Stage 4.5: Order Book Imbalance ─────────────────────────────────────────

  /**
   * Returns null when config.orderBookImbalance === 'skip' (the default), when
   * the venue is unreachable, or when the asset class does not support L2 depth
   * (forex, polymarket).
   *
   * Only called by CIODecisionEngine.decide() when orderBookImbalance === 'pre-entry-confirm'.
   */
  async runOrderBookImbalanceCheck(
    opp: Opportunity,
    userId: string,
    supabase?: SupabaseClient
  ): Promise<ImbalanceVerdict | null> {
    if ((this.config.orderBookImbalance ?? 'skip') === 'skip') return null
    if (opp.direction === 'neutral') return null
    return resolveAndFetchImbalance(
      opp.symbol,
      this.assetClass,
      opp.direction,
      userId,
      supabase
    )
  }

  // ── Stage 5: Red Team ────────────────────────────────────────────────────────

  async runRedTeam(opp: Opportunity): Promise<RedTeamVerdict> {
    const signalScore = opp.strength * 60
    const edgeScore = Math.min(20, Math.abs(opp.expectedReturn) * 500)
    const score = Math.min(100, signalScore + edgeScore)
    return {
      passed: score >= 30,
      score,
      reason: score < 30 ? `Composite red-team score ${score.toFixed(0)} below threshold` : undefined,
    }
  }

  // ── Stage 6: Risk ────────────────────────────────────────────────────────────

  async runRiskCheck(
    opp: Opportunity,
    _userId: string,
    _supabase?: SupabaseClient
  ): Promise<RiskVerdict> {
    const q = 1 - opp.strength
    const b = Math.abs(opp.expectedReturn) / 0.02  // assume 2% risk unit
    const kelly = b > 0 && opp.strength > 0 ? Math.max(0, (opp.strength * b - q) / b) : 0
    const veto = kelly <= 0 || opp.strength < 0.1
    return {
      veto,
      kellyFraction: kelly,
      reason: veto ? `Kelly=${kelly.toFixed(3)} — negative or zero edge` : undefined,
    }
  }

  // ── Stage 7: Size ────────────────────────────────────────────────────────────

  async sizePosition(
    _opp: Opportunity,
    verdicts: AllVerdicts,
    _userId: string,
    _supabase?: SupabaseClient
  ): Promise<PositionSize> {
    let fraction = verdicts.risk.kellyFraction
    if (verdicts.mirofish) fraction *= verdicts.mirofish.score / 100
    if (verdicts.kronos && !verdicts.kronos.pass) fraction *= 0.5
    fraction = Math.min(fraction, 0.10)
    const notionalUsd = fraction * 10000
    return {
      fraction,
      notionalUsd,
      rationale: `Kelly=${(verdicts.risk.kellyFraction * 100).toFixed(1)}% → capped ${(fraction * 100).toFixed(1)}%`,
    }
  }

  // ── Stage 8: Execute ─────────────────────────────────────────────────────────

  async execute(
    opp: Opportunity,
    size: PositionSize,
    userId: string,
    supabase?: SupabaseClient,
    cache?: BrokerCache,
    jurisdiction: Jurisdiction = 'us'
  ): Promise<ExecutionResult> {
    if (!supabase) {
      return { status: 'skipped', broker: 'none', error: 'no supabase client' }
    }

    const brokerAC = toBrokerAssetClass(opp.assetClass)
    const { broker } = selectBroker({ assetClass: brokerAC, userJurisdiction: jurisdiction })
    const adapter = await getBroker(broker, userId, supabase, cache)

    // Place bracket order if the opportunity specifies one
    if (opp.bracket) {
      const entryPrice = (opp.metadata.entryPrice as number | undefined) ?? 0
      const b = opp.bracket
      const bracketParams: BracketParams = {
        symbol: opp.symbol,
        asset_class: opp.assetClass,
        side: opp.direction === 'short' ? 'sell' : 'buy',
        notional_usd: size.notionalUsd,
        stop_price: b.stopPrice ?? (entryPrice > 0 && b.stopLossPct
          ? entryPrice * (opp.direction === 'long' ? 1 - b.stopLossPct : 1 + b.stopLossPct)
          : undefined),
        take_profit_price: b.takeProfitPrice ?? (entryPrice > 0 && b.takeProfitPct
          ? entryPrice * (opp.direction === 'long' ? 1 + b.takeProfitPct : 1 - b.takeProfitPct)
          : undefined),
        trail_pct: b.trailPct,
        time_in_force: 'gtc',
        jurisdiction,
      }
      const result = await adapter.placeBracketOrder(bracketParams)
      return {
        status: result.status === 'submitted' ? 'submitted' : result.status === 'skipped' ? 'skipped' : 'failed',
        broker,
        brokerOrderId: result.parent_order_id,
        error: result.error,
      }
    }

    const result = await adapter.execute({
      symbol: opp.symbol,
      asset_class: opp.assetClass,
      side: opp.direction === 'short' ? 'sell' : 'buy',
      notional_usd: size.notionalUsd,
    })

    const status: ExecutionResult['status'] =
      result.status === 'open' || result.status === 'submitted' ? 'submitted'
      : result.status === 'skipped' ? 'skipped'
      : 'failed'

    return { status, broker, brokerOrderId: result.broker_order_id, error: result.error }
  }

  /**
   * Called by PositionMonitor on each price tick for every open position belonging
   * to this strategy. Static stops/targets are handled broker-side via bracket orders;
   * this method handles DYNAMIC exit logic (e.g. trailing, regime change, signal reversal).
   *
   * Default: hold. Strategies override when dynamic exit logic is required.
   */
  async manageOpenPosition(
    _position: OpenPosition,
    _tick: PriceTick
  ): Promise<ManageAction> {
    return { type: 'hold' }
  }

  // ── Stage 9: Audit ───────────────────────────────────────────────────────────

  async logAudit(
    opp: Opportunity,
    decision: Decision,
    verdicts: AllVerdicts,
    supabase?: SupabaseClient
  ): Promise<void> {
    const row = {
      strategy_key: this.key,
      symbol: opp.symbol,
      edge_type: this.config.edgeType,
      mirofish_used: verdicts.mirofish?.used ?? false,
      kronos_used: verdicts.kronos?.used ?? false,
      decision: decision.action,
      size_fraction: decision.size?.fraction ?? 0,
      red_team_score: verdicts.redTeam.score,
      mirofish_score: verdicts.mirofish?.score ?? null,
      kronos_pass: verdicts.kronos?.pass ?? null,
      decided_at: new Date().toISOString(),
      metadata: { detected_at: opp.detectedAt, direction: opp.direction },
    }

    if (supabase) {
      supabase.from('audit_logs').insert(row).then(({ error }) => {
        if (error) console.warn('[audit] insert error:', error.message)
      })
    }

    console.log(
      `[audit] ${this.key} ${opp.symbol} → ${decision.action}` +
      ` | edge=${this.config.edgeType} mirofish_used=${row.mirofish_used} kronos_used=${row.kronos_used}`
    )
  }
}
