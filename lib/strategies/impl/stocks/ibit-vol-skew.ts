/**
 * IBIT Vol Skew — STRUCTURAL
 * Sell IBIT premium / buy Deribit BTC straddle delta when IBIT 30d IV minus
 * Deribit BTC IV exceeds 5 vol points. Mean-reversion trade, hold 5-10 days.
 * Source: wealth-os-vault/09 - Meta-Strategies/Strategy Analysis 2026-05-09 - Deep Scan.md
 */

import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type { Opportunity, OpportunityContext } from '../../pipeline-types'

export class IbitVolSkewStrategy extends BasePipelineStrategy {
  readonly key = 'ibit_vol_skew' as const
  readonly displayName = 'IBIT Vol Skew'
  readonly assetClass = 'options' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    return []
  }
}
