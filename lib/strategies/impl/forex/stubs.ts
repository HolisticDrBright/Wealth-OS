/**
 * Stub implementations for all 9 forex strategies.
 * All route to OANDA (default forex broker) unless jurisdiction demands fallback.
 */

import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type { Opportunity, OpportunityContext } from '../../pipeline-types'

function noOp(): Opportunity[] { return [] }

export class IctSmcStrategy extends BasePipelineStrategy {
  readonly key = 'ict_smc' as const
  readonly displayName = 'ICT Smart Money Concepts'
  readonly assetClass = 'forex' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class CarryTradeStrategy extends BasePipelineStrategy {
  readonly key = 'carry_trade' as const
  readonly displayName = 'Carry Trade'
  readonly assetClass = 'forex' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class CotPositioningStrategy extends BasePipelineStrategy {
  readonly key = 'cot_positioning' as const
  readonly displayName = 'COT Positioning'
  readonly assetClass = 'forex' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class CbDivergenceStrategy extends BasePipelineStrategy {
  readonly key = 'cb_divergence' as const
  readonly displayName = 'Central Bank Divergence'
  readonly assetClass = 'forex' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class SessionBreakoutStrategy extends BasePipelineStrategy {
  readonly key = 'session_breakout' as const
  readonly displayName = 'Session Range Breakout'
  readonly assetClass = 'forex' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class FxTrendfollowingStrategy extends BasePipelineStrategy {
  readonly key = 'fx_trendfollowing' as const
  readonly displayName = 'FX Trend Following'
  readonly assetClass = 'forex' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class MacroNewsEventStrategy extends BasePipelineStrategy {
  readonly key = 'macro_news_event' as const
  readonly displayName = 'Macro News Event Momentum'
  readonly assetClass = 'forex' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class TriangularArbStrategy extends BasePipelineStrategy {
  readonly key = 'triangular_arb' as const
  readonly displayName = 'Triangular Arbitrage'
  readonly assetClass = 'forex' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class CorrelationDivergenceStrategy extends BasePipelineStrategy {
  readonly key = 'correlation_divergence' as const
  readonly displayName = 'Correlation Divergence'
  readonly assetClass = 'multi-asset' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}
