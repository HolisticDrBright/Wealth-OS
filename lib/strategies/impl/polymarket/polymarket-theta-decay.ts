/**
 * Polymarket Theta Decay — STRUCTURAL
 * Sell Yes (buy No) on Polymarket markets where days-to-deadline >= 30, Yes >= 1.3x base rate, liquidity > $50k. Exit at base rate or T-7 days. Source: wealth-os-vault/09 - Meta-Strategies/Weekly Review 2026-05-09.md
 */

import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type { Opportunity, OpportunityContext } from '../../pipeline-types'

export class PolymarketThetaDecayStrategy extends BasePipelineStrategy {
  readonly key = 'polymarket_theta_decay' as const
  readonly displayName = 'Polymarket Theta Decay'
  readonly assetClass = 'polymarket' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    return []
  }
}
