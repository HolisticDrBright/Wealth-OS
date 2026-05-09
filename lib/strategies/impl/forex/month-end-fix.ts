/**
 * Month-End Fix — FLOW
 * Month-end 4pm London fix flow. Last trading day, if S&P − MSCI ex-US monthly return spread > 2%, fade USD on the fix bar. Hold 60-90 min. Source: wealth-os-vault/09 - Meta-Strategies/Weekly Review 2026-05-09.md
 */

import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type { Opportunity, OpportunityContext } from '../../pipeline-types'

export class MonthEndFixStrategy extends BasePipelineStrategy {
  readonly key = 'month_end_fix' as const
  readonly displayName = 'Month-End Fix'
  readonly assetClass = 'forex' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    return []
  }
}
