/**
 * Funding Basis Arb (Hyperliquid) — STRUCTURAL
 * Hyperliquid hourly-funding extension. Routes the short leg to HL when HL funding - CEX funding > 0.5 bps/hour and HL liquidity at 50bps within 5% of CEX leg. Cap $250k. Source: wealth-os-vault/09 - Meta-Strategies/Weekly Review 2026-05-09.md
 */

import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type { Opportunity, OpportunityContext } from '../../pipeline-types'

export class FundingBasisArbHyperliquidStrategy extends BasePipelineStrategy {
  readonly key = 'funding_basis_arb_hyperliquid' as const
  readonly displayName = 'Funding Basis Arb (Hyperliquid)'
  readonly assetClass = 'crypto' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    return []
  }
}
