/**
 * VIX Term Structure — STRUCTURAL
 * Sell weekly SPX 30-delta put-spreads when VIX9D - VIX1D > 3 and VIX < 22 and 5d RV < implied. Roll weekly, target 50% max profit, stop 2x credit. Source: wealth-os-vault/09 - Meta-Strategies/Weekly Review 2026-05-09.md
 */

import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type { Opportunity, OpportunityContext } from '../../pipeline-types'

export class VixTermStructureStrategy extends BasePipelineStrategy {
  readonly key = 'vix_term_structure' as const
  readonly displayName = 'VIX Term Structure'
  readonly assetClass = 'options' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    return []
  }
}
