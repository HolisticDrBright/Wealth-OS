/**
 * Tradeability + action gating for opportunities — pure logic so it can be unit
 * tested without a DOM. Core product rule: "Execute" is only ever the primary
 * action for live-eligible opportunities. Everything tradable-on-paper offers
 * "Paper Trade"; everything else offers "Review".
 */
import type { StrategyMaturityStatus } from '@/lib/strategies/strategy-registry'
import { getMaturityMeta } from '@/lib/strategies/strategy-display'

export type OppTradeability = 'live_eligible' | 'paper_only' | 'blocked'

/**
 * Derive tradeability from a strategy's maturity and whether the user has
 * explicitly enabled live execution. Live requires BOTH live-eligibility AND an
 * explicit opt-in; otherwise the most we offer is paper.
 */
export function tradeabilityFromMaturity(
  maturity: StrategyMaturityStatus | string | null | undefined,
  opts: { liveEnabled?: boolean } = {},
): OppTradeability {
  const meta = getMaturityMeta(maturity)
  if (meta.liveEligible && opts.liveEnabled === true) return 'live_eligible'
  if (meta.paperTradable) return 'paper_only'
  return 'blocked'
}

export type OppPrimaryAction = 'review_live' | 'paper_trade' | 'review'

export function primaryAction(t: OppTradeability): OppPrimaryAction {
  switch (t) {
    case 'live_eligible': return 'review_live'
    case 'paper_only':    return 'paper_trade'
    case 'blocked':       return 'review'
  }
}

export const PRIMARY_ACTION_LABEL: Record<OppPrimaryAction, string> = {
  review_live: 'Review for live',
  paper_trade: 'Paper Trade',
  review: 'Review',
}

/** True only when an execute/copy action may be surfaced as primary. */
export function allowsExecute(t: OppTradeability): boolean {
  return t === 'live_eligible'
}
