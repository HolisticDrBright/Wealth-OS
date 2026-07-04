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
import { preTradeRiskCheck } from '@/lib/risk/kill-switch'
import { edgeClearsCosts } from '@/lib/costs/transaction-costs'
import { computeEmpiricalSize, zeroSize } from '@/lib/risk/empirical-sizing'
import { getPortfolioUsd } from '@/lib/strategies/risk-controls'
import { executeIdempotent, placeBracketIdempotent } from '@/lib/broker-adapters/order-intents'
import { liveTradingEnabled, PAPER_PHASE_REASON, checkLiveApproval } from '@/lib/broker-adapters/execution-guard'
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
    // T4.3 — time-of-day guard: skip strategies during low-liquidity windows
    const { isTimeOfDayAllowed } = await import('@/lib/cadence/time-of-day-guards')
    if (!isTimeOfDayAllowed(this.assetClass, this.key)) return []

    // T4.2 — cross-asset regime gate
    const { detectRegime, CrossAssetRegime } = await import('@/lib/regime/cross-asset-regime')
    const regimeReading = await detectRegime()

    // CRISIS: block everything except tail_risk_hedging
    if (regimeReading.regime === CrossAssetRegime.CRISIS && this.key !== 'tail_risk_hedging') {
      return []
    }

    let opps = await this.detectOpportunities(ctx)
    if (opps.length === 0) return opps

    // RISK_OFF: apply 50% size haircut to directional opportunities
    if (regimeReading.regime === CrossAssetRegime.RISK_OFF) {
      opps = opps.map(opp =>
        opp.direction === 'neutral' ? opp : {
          ...opp,
          metadata: {
            ...opp.metadata,
            regimeHaircut: 0.5,
            reasoning: `${opp.metadata?.reasoning ?? ''} [RISK_OFF haircut 50%]`.trim(),
          },
        }
      )
    }

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
    // Cost floor first: the expected edge must clear 2× the venue round trip,
    // otherwise no score can save it. CIODecisionEngine.decide() hard-blocks on
    // this reason (never reduce_size — a smaller negative-net trade is still negative).
    const cost = edgeClearsCosts(Math.abs(opp.expectedReturn), opp.assetClass)
    if (!cost.clears) {
      return {
        passed: false,
        score: 0,
        reason: `edge_below_cost_floor: gross=${cost.grossBps}bps < 2× round-trip ${cost.costBps}bps (net=${cost.netBps}bps, venue=${opp.assetClass})`,
      }
    }

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

  /**
   * Kelly fraction from the shared empirical path: win probability comes from
   * the strategy's rolling calibration (or the maturity-floor probe when
   * uncalibrated) — NEVER from signal strength, which is a heuristic.
   */
  async runRiskCheck(
    opp: Opportunity,
    userId: string,
    supabase?: SupabaseClient
  ): Promise<RiskVerdict> {
    // W7: polymarket entries use the MEASURED per-category resolution prior
    // (category_bias corpus) as modelWinProb when the strategy has no rolling
    // calibration yet. No corpus row → no assumed edge (prior stays unset).
    let modelWinProb: number | undefined
    if (this.assetClass === 'polymarket' && supabase) {
      const category = (opp.metadata?.category ?? opp.metadata?.pmCategory) as string | undefined
      const price = (opp.metadata?.entryPrice ?? opp.metadata?.onChainPrice ?? opp.metadata?.price) as number | undefined
      if (category && typeof price === 'number' && price > 0 && price < 1) {
        try {
          const { loadCategoryPrior } = await import('@/lib/risk/polymarket-priors')
          const prior = await loadCategoryPrior(supabase, category, price)
          if (prior != null) modelWinProb = prior
        } catch { /* prior unavailable → sizing proceeds without an assumed edge */ }
      }
    }

    const sized = await computeEmpiricalSize({
      supabase,
      userId,
      strategyKey: this.key,
      opp,
      ...(modelWinProb != null ? { modelWinProb } : {}),
    })
    const veto = sized.blocked || sized.fraction <= 0
    return {
      veto,
      kellyFraction: sized.fraction,
      reason: veto ? (sized.reason ?? 'empirical Kelly fraction is zero') : undefined,
    }
  }

  // ── Stage 7: Size ────────────────────────────────────────────────────────────

  async sizePosition(
    opp: Opportunity,
    verdicts: AllVerdicts,
    userId: string,
    supabase?: SupabaseClient
  ): Promise<PositionSize> {
    let fraction = verdicts.risk.kellyFraction
    if (verdicts.mirofish) fraction *= verdicts.mirofish.score / 100
    if (verdicts.kronos && !verdicts.kronos.pass) fraction *= 0.5
    fraction = Math.min(fraction, 0.10)

    // Real account equity only — refuse to size when it cannot be fetched.
    const portfolioUsd = supabase ? await getPortfolioUsd(supabase, userId) : null
    if (portfolioUsd == null) {
      const reason = 'equity_unavailable: refusing to size — never default equity'
      if (supabase) {
        try {
          await supabase.from('audit_logs').insert({
            user_id: userId,
            strategy_key: this.key,
            symbol: opp.symbol,
            decision: 'block',
            size_fraction: 0,
            mirofish_used: false,
            kronos_used: false,
            decided_at: new Date().toISOString(),
            metadata: { blocked_by: 'sizePosition', reason },
          })
        } catch (err) {
          console.warn('[sizePosition] audit insert failed:', err)
        }
      }
      console.warn(`[sizePosition] ${this.key} ${opp.symbol}: ${reason}`)
      return zeroSize(reason)
    }

    const notionalUsd = fraction * portfolioUsd
    return {
      fraction,
      notionalUsd,
      rationale: `Kelly=${(verdicts.risk.kellyFraction * 100).toFixed(1)}% → capped ${(fraction * 100).toFixed(1)}% of $${Math.round(portfolioUsd).toLocaleString()}`,
    }
  }

  // ── Stage 8: Execute ─────────────────────────────────────────────────────────

  /**
   * Runtime kill switch — MUST be called by every execute() implementation
   * (including subclass overrides) before touching a broker adapter.
   * Returns an ExecutionResult when the trade is blocked (already audited),
   * or null when the trade may proceed.
   */
  protected async checkKillSwitch(
    opp: Opportunity,
    userId: string,
    supabase: SupabaseClient
  ): Promise<ExecutionResult | null> {
    const verdict = await preTradeRiskCheck({
      supabase,
      userId,
      strategyKey: this.key,
    })
    if (verdict.allowed) return null

    // Blocked trades are logged to the audit trail, never silently dropped.
    const reason = `kill_switch: ${verdict.reason}`
    try {
      await supabase.from('audit_logs').insert({
        user_id: userId,
        strategy_key: this.key,
        symbol: opp.symbol,
        edge_type: this.config.edgeType,
        mirofish_used: false,
        kronos_used: false,
        decision: 'block',
        size_fraction: 0,
        decided_at: new Date().toISOString(),
        metadata: { blocked_by: 'kill_switch', reason: verdict.reason, direction: opp.direction },
      })
    } catch (err) {
      console.warn('[kill-switch] audit insert failed:', err)
    }
    console.warn(`[kill-switch] BLOCKED ${this.key} ${opp.symbol}: ${verdict.reason}`)
    return { status: 'skipped', broker: 'none', error: reason }
  }

  /**
   * Hard live gate — execute() paths talk to REAL broker adapters. Paper
   * trading never comes through here (PaperBroker only). Requires the
   * LIVE_TRADING_ENABLED master switch AND explicit live approval
   * (maturity live_candidate + user live_enabled=true; is_enabled is never
   * a live signal). MUST be called by every execute() override.
   */
  protected async checkLiveGate(
    opp: Opportunity,
    userId: string,
    supabase: SupabaseClient
  ): Promise<ExecutionResult | null> {
    if (!liveTradingEnabled()) {
      return { status: 'skipped', broker: 'none', error: PAPER_PHASE_REASON }
    }
    const approval = await checkLiveApproval(supabase, userId, this.key)
    if (!approval.approved) {
      try {
        await supabase.from('audit_logs').insert({
          user_id: userId, strategy_key: this.key, symbol: opp.symbol,
          decision: 'block', size_fraction: 0, mirofish_used: false, kronos_used: false,
          decided_at: new Date().toISOString(),
          metadata: { blocked_by: 'live_approval_gate', reason: approval.reason },
        })
      } catch { /* audit best-effort; the block below is the guarantee */ }
      return { status: 'skipped', broker: 'none', error: `live_approval_gate: ${approval.reason}` }
    }
    return null
  }

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

    const blocked = await this.checkKillSwitch(opp, userId, supabase)
    if (blocked) return blocked

    const liveBlocked = await this.checkLiveGate(opp, userId, supabase)
    if (liveBlocked) return liveBlocked

    const brokerAC = toBrokerAssetClass(opp.assetClass)
    const selection = selectBroker({ assetClass: brokerAC, userJurisdiction: jurisdiction })
    if (selection.broker === null) {
      return { status: 'skipped', broker: 'none', error: `no_legal_broker: ${selection.detail}` }
    }
    const broker = selection.broker
    const adapter = await getBroker(broker, userId, supabase, cache)

    // W6/audit residue 4: LIVE submissions write their decision_log row at
    // SUBMISSION time and thread the id into the order intent — provenance
    // is relational from the first write, not backfilled at grading. Only
    // reached in live mode (checkLiveGate already passed). Best-effort:
    // a failed decision insert never blocks the order.
    let decisionId: string | null = null
    try {
      const { data: dec } = await supabase
        .from('decision_log')
        .insert({
          user_id: userId,
          strategy: this.key,
          symbol: opp.symbol,
          confidence: Math.min(1, Math.max(0, opp.strength)),
          predicted_direction: opp.direction === 'long' ? 1 : 0,
          asset_class: opp.assetClass,
          outcome_graded: false,
        })
        .select('id')
        .single()
      decisionId = (dec?.id as string | undefined) ?? null
    } catch { /* provenance is best-effort at submission; grading backfills */ }

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
      const result = await placeBracketIdempotent(adapter, bracketParams, {
        supabase, userId, opportunityId: opp.id, decisionId,
      })
      return {
        status: result.status === 'submitted' ? 'submitted' : result.status === 'skipped' ? 'skipped' : 'failed',
        broker,
        brokerOrderId: result.parent_order_id,
        error: result.error,
      }
    }

    const result = await executeIdempotent(adapter, {
      symbol: opp.symbol,
      asset_class: opp.assetClass,
      side: opp.direction === 'short' ? 'sell' : 'buy',
      notional_usd: size.notionalUsd,
    }, { supabase, userId, opportunityId: opp.id, decisionId })

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
    supabase?: SupabaseClient,
    userId?: string
  ): Promise<void> {
    const row: Record<string, unknown> = {
      user_id: userId,
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
    if (userId) row.user_id = userId

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
