/**
 * PEAD Microcap Text — EVENT
 * PEAD-Microcap with earnings-call sentiment overlay. Fires when market cap < $500M, SUE > 1.5σ, polarity > +0.3 or < -0.3. Source: wealth-os-vault/09 - Meta-Strategies/Weekly Review 2026-05-09.md
 */

import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type { Opportunity, OpportunityContext } from '../../pipeline-types'

export class PeadMicrocapTextStrategy extends BasePipelineStrategy {
  readonly key = 'pead_microcap_text' as const
  readonly displayName = 'PEAD Microcap Text'
  readonly assetClass = 'stocks' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    return []
  }
}
