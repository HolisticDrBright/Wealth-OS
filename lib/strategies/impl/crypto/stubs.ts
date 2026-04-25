/**
 * Stub implementations for 7 remaining crypto strategies.
 */

import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type { Opportunity, OpportunityContext } from '../../pipeline-types'

function noOp(): Opportunity[] { return [] }

// DcaHalvingStrategy moved to ./dca-halving.ts

export class OnchainSignalStrategy extends BasePipelineStrategy {
  readonly key = 'onchain_signal' as const
  readonly displayName = 'On-Chain Signal (Glassnode)'
  readonly assetClass = 'crypto' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class DefiYieldStrategy extends BasePipelineStrategy {
  readonly key = 'defi_yield' as const
  readonly displayName = 'DeFi Yield Farming'
  readonly assetClass = 'crypto' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class NarrativeRotationStrategy extends BasePipelineStrategy {
  readonly key = 'narrative_rotation' as const
  readonly displayName = 'Crypto Narrative Rotation'
  readonly assetClass = 'crypto' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class LiquidationHuntingStrategy extends BasePipelineStrategy {
  readonly key = 'liquidation_hunting' as const
  readonly displayName = 'Liquidation Level Hunter'
  readonly assetClass = 'crypto' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class AirdropFarmingStrategy extends BasePipelineStrategy {
  readonly key = 'airdrop_farming' as const
  readonly displayName = 'Airdrop Farming'
  readonly assetClass = 'crypto' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class MemecoinBondingcurveStrategy extends BasePipelineStrategy {
  readonly key = 'memecoin_bondingcurve' as const
  readonly displayName = 'Memecoin Bonding Curve'
  readonly assetClass = 'crypto' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}
