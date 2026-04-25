/**
 * Stub implementations for 8 remaining Polymarket strategies.
 * All route to the Polymarket adapter.
 */

import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type { Opportunity, OpportunityContext } from '../../pipeline-types'

function noOp(): Opportunity[] { return [] }

export class PolymarketResolutionRulesStrategy extends BasePipelineStrategy {
  readonly key = 'polymarket_resolution_rules' as const
  readonly displayName = 'Polymarket Resolution Rules'
  readonly assetClass = 'polymarket' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class PolymarketBaseRateStrategy extends BasePipelineStrategy {
  readonly key = 'polymarket_base_rate' as const
  readonly displayName = 'Polymarket Base Rate'
  readonly assetClass = 'polymarket' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

// PolymarketInfoLagStrategy moved to ./polymarket-info-lag.ts

export class PolymarketCrossMarketStrategy extends BasePipelineStrategy {
  readonly key = 'polymarket_cross_market' as const
  readonly displayName = 'Polymarket Cross-Market'
  readonly assetClass = 'polymarket' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class PolymarketEventCompressionStrategy extends BasePipelineStrategy {
  readonly key = 'polymarket_event_compression' as const
  readonly displayName = 'Polymarket Event Compression'
  readonly assetClass = 'polymarket' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class PolymarketNarrativeFadeStrategy extends BasePipelineStrategy {
  readonly key = 'polymarket_narrative_fade' as const
  readonly displayName = 'Polymarket Narrative Fade'
  readonly assetClass = 'polymarket' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class PolymarketLiquidityPocketStrategy extends BasePipelineStrategy {
  readonly key = 'polymarket_liquidity_pocket' as const
  readonly displayName = 'Polymarket Liquidity Pocket'
  readonly assetClass = 'polymarket' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class PolymarketNoTradeStrategy extends BasePipelineStrategy {
  readonly key = 'polymarket_no_trade' as const
  readonly displayName = 'Polymarket No-Trade'
  readonly assetClass = 'polymarket' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}
