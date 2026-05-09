/**
 * Pendle PT Fixed Yield — STRUCTURAL
 * Pendle PT-sUSDe fixed-yield lock when sUSDe APY < 9.5% AND PT yield > 8.0% AND maturity < 90d. Hold to maturity. Source: wealth-os-vault/09 - Meta-Strategies/Weekly Review 2026-05-09.md
 */

import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type { Opportunity, OpportunityContext } from '../../pipeline-types'

export class PendlePtFixedYieldStrategy extends BasePipelineStrategy {
  readonly key = 'pendle_pt_fixed_yield' as const
  readonly displayName = 'Pendle PT Fixed Yield'
  readonly assetClass = 'crypto' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    return []
  }
}
