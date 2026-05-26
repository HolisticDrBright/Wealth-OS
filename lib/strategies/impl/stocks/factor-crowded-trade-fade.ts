/**
 * Factor Crowded Trade Fade — SENTIMENT
 * When the HFRX Equity Market Neutral index drops >1% over 5 days, identify the
 * unwinding factor (highest 1-year crowding score via Premialab/AQR data) and go
 * long the corresponding ETF. Hold 5-15 days for the mean-reversion bounce.
 * Source: wealth-os-vault/09 - Meta-Strategies/Strategy Analysis 2026-05-09 - Deep Scan.md
 */

import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type { Opportunity, OpportunityContext } from '../../pipeline-types'

export class FactorCrowdedTradeFadeStrategy extends BasePipelineStrategy {
  readonly key = 'factor_crowded_trade_fade' as const
  readonly displayName = 'Factor Crowded Trade Fade'
  readonly assetClass = 'stocks' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    return []
  }
}
