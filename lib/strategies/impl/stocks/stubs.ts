/**
 * Stub implementations for 11 remaining stock strategies.
 * Each correctly declares key/displayName/assetClass and overrides
 * detectOpportunities — signal logic filled in Prompt 8.
 */

import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type { Opportunity, OpportunityContext } from '../../pipeline-types'

function noOp(): Opportunity[] { return [] }

export class QuantMomentumStrategy extends BasePipelineStrategy {
  readonly key = 'quant_momentum' as const
  readonly displayName = '12-1 Quant Momentum'
  readonly assetClass = 'stocks' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class QvmMultifactorStrategy extends BasePipelineStrategy {
  readonly key = 'qvm_multifactor' as const
  readonly displayName = 'QVM Multi-Factor'
  readonly assetClass = 'stocks' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class DividendAristocratStrategy extends BasePipelineStrategy {
  readonly key = 'dividend_aristocrat' as const
  readonly displayName = 'Dividend Aristocrat'
  readonly assetClass = 'stocks' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class SectorRotationStrategy extends BasePipelineStrategy {
  readonly key = 'sector_rotation' as const
  readonly displayName = 'Sector Rotation'
  readonly assetClass = 'stocks' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class PeadStrategy extends BasePipelineStrategy {
  readonly key = 'pead' as const
  readonly displayName = 'Post-Earnings Announcement Drift'
  readonly assetClass = 'stocks' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class OptionsWheelStrategy extends BasePipelineStrategy {
  readonly key = 'options_wheel' as const
  readonly displayName = 'Options Wheel'
  readonly assetClass = 'options' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class GammaExposureStrategy extends BasePipelineStrategy {
  readonly key = 'gamma_exposure' as const
  readonly displayName = 'Gamma Exposure Hedge'
  readonly assetClass = 'options' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class MergerArbStrategy extends BasePipelineStrategy {
  readonly key = 'merger_arb' as const
  readonly displayName = 'Merger Arbitrage'
  readonly assetClass = 'stocks' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class SpinoffStrategy extends BasePipelineStrategy {
  readonly key = 'spinoff' as const
  readonly displayName = 'Spinoff Alpha'
  readonly assetClass = 'stocks' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

export class TailRiskHedgingStrategy extends BasePipelineStrategy {
  readonly key = 'tail_risk_hedging' as const
  readonly displayName = 'Tail Risk Hedging'
  readonly assetClass = 'options' as const
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> { return noOp() }
}

// AutopilotCongressionalStrategy moved to ./autopilot-congressional.ts
