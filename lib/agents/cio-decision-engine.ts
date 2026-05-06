import type { TradeContext, AgentOutput, CIODecision, ConfidenceLevel } from './types'
import { miroFishClient, simulateWithClaude } from './mirofish-client'
import { renderDecisionNote } from '../vault/templates'
import { writeFile } from '../vault/client'
import { DIRECTOR_CIO_PROMPT } from '@/lib/integrations/autohedge-distilled/director-cio-prompt'
import {
  OrchestratorAgent,
  ClientProfileAgent,
  PortfolioDiagnosticAgent,
  FundamentalEquityAgent,
  TechnicalMarketAgent,
  QuantScreeningAgent,
  MacroRegimeAgent,
  CryptoIntelligenceAgent,
  ForexStrategyAgent,
  RiskManagementAgent,
  TaxOptimizationAgent,
  RetirementExecutionAgent,
} from './agents/all-agents'
import Anthropic from '@anthropic-ai/sdk'

const USE_AUTOHEDGE_DISTILLED = process.env.USE_AUTOHEDGE_DISTILLED_PROMPTS === 'true'
const anthropic = new Anthropic()

// ─── Tier definitions for parallel execution ──────────────────────────────
const tier2Agents = [
  new ClientProfileAgent(),
  new PortfolioDiagnosticAgent(),
  new FundamentalEquityAgent(),
  new TechnicalMarketAgent(),
  new QuantScreeningAgent(),
  new MacroRegimeAgent(),
  new CryptoIntelligenceAgent(),
  new ForexStrategyAgent(),
]

const tier3Agents = [
  new RiskManagementAgent(),
  new TaxOptimizationAgent(),
  new RetirementExecutionAgent(),
]

export class CIODecisionEngine {
  async analyze(context: TradeContext): Promise<CIODecision> {
    console.log(`[CIO] Analyzing trade: ${context.trade.action} ${context.trade.symbol}`)

    // ── Tier 1: Orchestrator ──────────────────────────────────────────────
    const orchestrator = new OrchestratorAgent()
    const orchestratorOutput = await orchestrator.run(context)

    // ── Tier 2: Domain experts (parallel) ────────────────────────────────
    const tier2Outputs = await Promise.all(
      tier2Agents.map(agent => agent.run(context))
    )

    // ── Tier 3: Risk, Tax, Retirement (parallel) ──────────────────────────
    const tier3Outputs = await Promise.all(
      tier3Agents.map(agent => agent.run(context))
    )

    // ── Tier 4: MiroFish simulation (Agent 13) ────────────────────────────
    let miroFishScore: number | undefined
    let miroFishOutput: AgentOutput | undefined

    try {
      const useRealMiroFish = !!process.env.MIROFISH_BASE_URL
      const report = useRealMiroFish
        ? await miroFishClient.pollUntilComplete(
            (await miroFishClient.startSimulation({
              seedContent: buildSeedContent(context),
              predictionQuery: `Should we copy this trade: ${context.trade.action} ${context.trade.symbol} at $${context.trade.notional_value.toLocaleString()}?`,
            })).jobId
          )
        : await simulateWithClaude(context)

      miroFishScore = miroFishClient.computeSimulationScore(report)

      miroFishOutput = {
        agent: 'MiroFishSimulationAgent',
        recommendation: miroFishScore >= 65 ? 'approve' : miroFishScore >= 45 ? 'reduce' : 'reject',
        confidence: report.confidenceLevel,
        score: miroFishScore,
        reasoning: report.scenarioSummary,
        keyPoints: report.keyFindings,
        metadata: {
          bullProbability: report.bullProbability,
          bearProbability: report.bearProbability,
          consensusDirection: report.consensusDirection,
          tailRiskScore: report.tailRiskScore,
        },
      }
    } catch (err) {
      console.warn('[CIO] MiroFish failed, using neutral score:', err)
      miroFishOutput = {
        agent: 'MiroFishSimulationAgent',
        recommendation: 'defer',
        confidence: 'low',
        score: 50,
        reasoning: 'Simulation unavailable',
        keyPoints: [],
      }
    }

    // ── Compile all agent outputs ─────────────────────────────────────────
    const allOutputs: AgentOutput[] = [
      orchestratorOutput,
      ...tier2Outputs,
      ...tier3Outputs,
      miroFishOutput,
    ]

    // ── Risk Management veto check ────────────────────────────────────────
    const riskOutput = tier3Outputs.find(o => o.agent === 'RiskManagementAgent')
    if (riskOutput?.recommendation === 'reject') {
      return this.buildDecision('reject', context, allOutputs, miroFishScore,
        `VETOED by RiskManagementAgent: ${riskOutput.reasoning}`)
    }

    // ── Compute final score ───────────────────────────────────────────────
    const weights: Record<string, number> = {
      OrchestratorAgent: 0.05,
      ClientProfileAgent: 0.08,
      PortfolioDiagnosticAgent: 0.10,
      FundamentalEquityAgent: 0.10,
      TechnicalMarketAgent: 0.07,
      QuantScreeningAgent: 0.07,
      MacroRegimeAgent: 0.08,
      CryptoIntelligenceAgent: 0.05,
      ForexStrategyAgent: 0.05,
      RiskManagementAgent: 0.12,
      TaxOptimizationAgent: 0.05,
      RetirementExecutionAgent: 0.05,
      MiroFishSimulationAgent: 0.13,
    }

    let weightedScore = 0
    let totalWeight = 0
    for (const output of allOutputs) {
      const w = weights[output.agent] ?? 0.05
      weightedScore += output.score * w
      totalWeight += w
    }
    const finalScore = totalWeight > 0 ? weightedScore / totalWeight : 50

    // ── Map score to decision ─────────────────────────────────────────────
    const decision = finalScore >= 68 ? 'execute'
      : finalScore >= 52 ? 'reduce'
      : finalScore >= 38 ? 'defer'
      : 'reject'

    return this.buildDecision(decision, context, allOutputs, miroFishScore)
  }

  private async buildDecision(
    decision: CIODecision['decision'],
    context: TradeContext,
    allOutputs: AgentOutput[],
    miroFishScore: number | undefined,
    vetoReason?: string
  ): Promise<CIODecision> {
    const { trade, user } = context
    const agentScores: Record<string, number> = {}
    for (const o of allOutputs) agentScores[o.agent] = o.score

    // ── CIO synthesis via Claude Opus ─────────────────────────────────────
    const promptVariant = USE_AUTOHEDGE_DISTILLED ? 'autohedge_distilled_v1' : 'native'
    const systemPrompt = USE_AUTOHEDGE_DISTILLED ? DIRECTOR_CIO_PROMPT : undefined

    const summaryPrompt = `${USE_AUTOHEDGE_DISTILLED ? '' : 'You are the Chief Investment Officer synthesizing an investment committee analysis.\n\n'}TRADE: ${trade.action.toUpperCase()} ${trade.symbol} (${trade.asset_class}) — $${trade.notional_value.toLocaleString()}
TRADER: ${trade.trader_name} (${trade.trader_return_pct}% 30d, ${trade.trader_win_rate}% win rate)
COMMITTEE DECISION: ${decision.toUpperCase()}
${vetoReason ? `VETO REASON: ${vetoReason}` : ''}

AGENT SCORES: ${Object.entries(agentScores).map(([k, v]) => `${k}: ${v}`).join(', ')}

Write a CIO synthesis as JSON:
{
  "investmentCommitteeView": "<2-3 sentence committee consensus>",
  "portfolioImpact": "<how this affects the portfolio>",
  "positionSizing": {
    "recommended_pct": <1-10>,
    "max_pct": <1-15>,
    "rationale": "<why this size>"
  },
  "accountPlacement": "<taxable vs IRA vs 401k recommendation>",
  "timing": "<execute now, wait for pullback, scale in, etc>",
  "riskFactors": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "confidence": "high"|"medium"|"low",
  "plainEnglishSummary": "<1 paragraph plain English summary for the investor>"
}`

    let synthesis: Partial<CIODecision> = {}
    const synthStart = Date.now()
    try {
      const msg = await anthropic.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        thinking: { type: 'adaptive' },
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: [{ role: 'user', content: summaryPrompt }],
      })
      const text = msg.content.find(b => b.type === 'text')?.text ?? '{}'
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      synthesis = JSON.parse(jsonMatch?.[0] ?? '{}')
    } catch (err) {
      console.error('[CIO] synthesis failed:', err)
    }

    // Log prompt variant performance for A/B comparison (fire-and-forget)
    try {
      const { createClient } = await import('@/lib/supabase/server')
      const supabase = await createClient()
      supabase.from('agent_performance_logs').insert({
        agent_name: 'CIODecisionEngine',
        prompt_variant: promptVariant,
        scenario: { trade, agentScores },
        decision,
        reasoning: vetoReason ?? `Committee score logged`,
        latency_ms: Date.now() - synthStart,
      }).then(() => {}, () => {})
    } catch { /* non-critical */ }

    const scores = Object.values(agentScores)
    const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 50

    // Adjust recommended_pct based on decision
    const recommendedPct = decision === 'execute'
      ? Math.min(synthesis.positionSizing?.recommended_pct ?? 5, user.max_allocation_pct ?? 10)
      : decision === 'reduce'
      ? Math.min((synthesis.positionSizing?.recommended_pct ?? 5) * 0.5, 3)
      : 0

    const result: CIODecision = {
      decision,
      reasoning: vetoReason ?? `Committee score: ${avgScore.toFixed(1)}/100`,
      investmentCommitteeView: synthesis.investmentCommitteeView ?? '',
      portfolioImpact: synthesis.portfolioImpact ?? '',
      positionSizing: {
        recommended_pct: recommendedPct,
        max_pct: synthesis.positionSizing?.max_pct ?? 10,
        rationale: synthesis.positionSizing?.rationale ?? '',
      },
      accountPlacement: synthesis.accountPlacement ?? 'taxable',
      timing: synthesis.timing ?? 'execute now',
      riskFactors: synthesis.riskFactors ?? [],
      confidence: (synthesis.confidence as ConfidenceLevel) ?? 'medium',
      plainEnglishSummary: synthesis.plainEnglishSummary ?? '',
      agentScores,
      agentOutputs: allOutputs,
      miroFishScore,
      finalScore: avgScore,
    }

    // Persist decision note to vault (best-effort — never fails the decision)
    try {
      const { path, content } = renderDecisionNote(result, context)
      await writeFile(
        path,
        content,
        `feat: CIO decision ${decision.toUpperCase()} ${context.trade.symbol} (score ${avgScore.toFixed(0)})`,
        'CIODecisionEngine',
      )
      console.log(`[CIO] Vault note written: ${path}`)
    } catch (err) {
      console.warn('[CIO] Vault write skipped:', err instanceof Error ? err.message : err)
    }

    return result
  }

  /**
   * Pipeline orchestrator — runs all 9 stages for a single Opportunity and
   * returns a typed Decision. Designed to be called from the strategy executor
   * or the copy-trade worker.
   *
   * Blocking rules (in priority order):
   *   1. risk.veto → block
   *   2. mirofish scenario=bear AND opp.direction=long → reduce_size
   *   3. kronos.skew=bearish AND opp.direction=long AND kronos.pass=false → block
   *   4. redTeam.passed=false → reduce_size
   *   5. otherwise → execute
   */
  async decide(
    opp: import('@/lib/strategies/pipeline-types').Opportunity,
    userId: string,
    supabase: import('@supabase/supabase-js').SupabaseClient,
    cache?: import('@/lib/brokers/BrokerFactory').BrokerCache,
    options?: { paperMode?: boolean }
  ): Promise<import('@/lib/strategies/pipeline-types').Decision> {
    const { strategyRegistry } = await import('@/lib/strategies/all-pipeline-strategies')
    const strat = strategyRegistry.get(opp.strategyKey)

    const edge     = await strat.classifyEdge(opp)
    const mirofish = await strat.runMiroFishConfluence(opp, userId, supabase)
    const kronos   = await strat.runKronosConfluence(opp, userId, supabase)
    const redTeam  = await strat.runRedTeam(opp)
    const risk     = await strat.runRiskCheck(opp, userId, supabase)

    const verdicts: import('@/lib/strategies/pipeline-types').AllVerdicts = { mirofish, kronos, redTeam, risk }

    // Gate 1 — risk veto
    if (risk.veto) {
      const decision = { action: 'block' as const, reason: risk.reason ?? 'risk veto' }
      await strat.logAudit(opp, decision, verdicts, supabase)
      return decision
    }

    // Gate 1.5 — order book imbalance pre-entry confirmation (fail-open: neutral passes)
    if ((strat.config.orderBookImbalance ?? 'skip') === 'pre-entry-confirm') {
      const imbalance = await strat.runOrderBookImbalanceCheck(opp, userId, supabase)
      if (imbalance && imbalance.signal !== 'neutral') {
        const opposes =
          (opp.direction === 'long'  && imbalance.signal === 'bear') ||
          (opp.direction === 'short' && imbalance.signal === 'bull')
        if (opposes) {
          const size = await strat.sizePosition(opp, verdicts, userId)
          const decision = {
            action: 'reduce_size' as const,
            reason: `order book imbalance opposes ${opp.direction} (${imbalance.signal}, ratio=${imbalance.ratio.toFixed(2)})`,
            size,
          }
          await strat.logAudit(opp, decision, verdicts, supabase)
          return decision
        }
      }
    }

    // Gate 2 — MiroFish bear opposes long
    if (mirofish?.scenario === 'bear' && opp.direction === 'long') {
      const size = await strat.sizePosition(opp, verdicts, userId)
      const decision = { action: 'reduce_size' as const, reason: 'mirofish bear scenario', size }
      await strat.logAudit(opp, decision, verdicts, supabase)
      return decision
    }

    // Gate 3 — Kronos blocks
    if (kronos && !kronos.pass && opp.direction === 'long') {
      const decision = { action: 'block' as const, reason: `kronos contradicts: ${kronos.reason}` }
      await strat.logAudit(opp, decision, verdicts, supabase)
      return decision
    }

    // Gate 4 — red team
    if (!redTeam.passed) {
      const size = await strat.sizePosition(opp, verdicts, userId)
      const decision = { action: 'reduce_size' as const, reason: redTeam.reason ?? 'red team score low', size }
      await strat.logAudit(opp, decision, verdicts, supabase)
      return decision
    }

    // Confluence boost/penalty: registered signals from other strategies
    const { confluenceRegistry } = await import('@/lib/strategies/confluence-registry')
    const cons = confluenceRegistry.consensus(opp.symbol)
    let confluenceMultiplier = 1.0
    if (cons.direction === opp.direction) {
      if (cons.agreementCount >= 3) confluenceMultiplier = 1.5
      else if (cons.agreementCount >= 2) confluenceMultiplier = 1.25
    }
    if (cons.disagreementCount >= 1) confluenceMultiplier *= 0.5

    // T4.1 — Adaptive sizing via rolling Brier score
    const { getRollingBrier } = await import('@/lib/learning/rolling-brier')
    const brierResult = await getRollingBrier(supabase, opp.strategyKey, 30)
    const brierMultiplier = brierResult?.sizingMultiplier ?? 1.0

    // T4.5 — Anti-correlation hedge: dynamically size tail_risk_hedging
    let tailHedgeOverride: number | null = null
    if (opp.strategyKey === 'tail_risk_hedging') {
      const { data: openPositions } = await supabase
        .from('user_copied_positions')
        .select('size_fraction, strategy_key')
        .eq('user_id', userId)
        .eq('status', 'open')
      const positions = (openPositions ?? []) as Array<{ size_fraction: number; strategy_key: string }>
      const totalDirectionalDelta = positions
        .filter(p => p.strategy_key !== 'tail_risk_hedging')
        .reduce((s, p) => s + (p.size_fraction ?? 0), 0)
      tailHedgeOverride = Math.min(0.15, 0.02 + totalDirectionalDelta * 0.06)
    }

    // Execute with confluence + brier adjusted size
    const rawSize = await strat.sizePosition(opp, verdicts, userId, supabase)

    let adjustedFraction = rawSize.fraction * confluenceMultiplier * brierMultiplier
    let adjustedNotional  = rawSize.notionalUsd * confluenceMultiplier * brierMultiplier

    if (tailHedgeOverride !== null) {
      const portfolio = rawSize.notionalUsd / Math.max(rawSize.fraction, 0.001)
      adjustedFraction = tailHedgeOverride
      adjustedNotional = tailHedgeOverride * portfolio
    }

    // Apply regime haircut from detectWithConfluence metadata
    const regimeHaircut = (opp.metadata?.regimeHaircut as number | undefined) ?? 1.0
    adjustedFraction *= regimeHaircut
    adjustedNotional *= regimeHaircut

    // T4.4 — Correlation-aware sizing caps (fetch current book)
    const { applyCorrelationCaps } = await import('@/lib/risk/correlation-aware-sizing')
    const { data: bookRows } = await supabase
      .from('user_copied_positions')
      .select('strategy_key, size_notional_usd')
      .eq('user_id', userId)
      .eq('status', 'open')
    const portfolioUsd = rawSize.fraction > 0 ? rawSize.notionalUsd / rawSize.fraction : 10_000
    const currentBook = (bookRows ?? []).map((r: Record<string, unknown>) => ({
      strategyKey: r.strategy_key as import('@/lib/strategies/strategy-registry').StrategyKey,
      assetClass: strat.assetClass,
      notionalUsd: (r.size_notional_usd as number) ?? 0,
    }))
    const corr = applyCorrelationCaps(
      opp.strategyKey,
      strat.assetClass,
      adjustedNotional,
      portfolioUsd,
      currentBook
    )

    const rationale = [
      rawSize.rationale,
      confluenceMultiplier !== 1.0 ? `confluence x${confluenceMultiplier.toFixed(2)}` : null,
      brierMultiplier !== 1.0 ? `brier x${brierMultiplier.toFixed(2)} (score=${brierResult?.brierScore.toFixed(3)})` : null,
      tailHedgeOverride !== null ? `hedge override ${(tailHedgeOverride * 100).toFixed(1)}%` : null,
      regimeHaircut < 1.0 ? `RISK_OFF haircut ${(regimeHaircut * 100).toFixed(0)}%` : null,
      corr.capApplied ? `${corr.capApplied} cap applied` : null,
    ].filter(Boolean).join(' | ')

    const size: import('@/lib/strategies/pipeline-types').PositionSize = {
      ...rawSize,
      fraction:    portfolioUsd > 0 ? corr.notionalUsd / portfolioUsd : 0,
      notionalUsd: corr.notionalUsd,
      rationale,
    }

    const decision = { action: 'execute' as const, size }
    await strat.logAudit(opp, decision, verdicts, supabase)
    // In paper mode the caller (PaperTradeRunner) handles the fill — skip real broker
    if (!options?.paperMode) {
      strat.execute(opp, size, userId, supabase, cache).catch(err =>
        console.error(`[CIO] execute failed for ${opp.symbol}:`, err)
      )
    }
    return decision

    void edge  // referenced for audit trail completeness
  }
}

function buildSeedContent(context: TradeContext): string {
  const { trade, user } = context
  return `
Trade Signal: ${trade.trader_name} is making a ${trade.action} order on ${trade.symbol} (${trade.asset_class}) worth $${trade.notional_value.toLocaleString()}.
Trader Track Record: ${trade.trader_return_pct}% 30-day return, ${trade.trader_win_rate}% win rate.
Investor Net Worth: $${user.total_net_worth.toLocaleString()}.
Risk Profile: ${user.risk_profile ?? 'moderate'}.
Portfolio Holdings: ${user.portfolio.map(a => `${a.name}: $${a.current_value.toLocaleString()}`).join(', ')}.
  `.trim()
}
