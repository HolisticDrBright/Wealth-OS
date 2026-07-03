/**
 * Behavioral guardrails (KB §8) — the ~150bps/yr advisor value, as code.
 * Friction is ASYMMETRIC: executing a scheduled de-risk is easy; cancelling
 * one requires typed confirmation + a 24h cooling-off.
 */

import type { KbParameters } from './types'

export const COOLING_OFF_HOURS = 24
export const PANIC_DRAWDOWN_THRESHOLD = 0.10

/** Cancelling a SCHEDULED de-risk needs typed confirmation + 24h wait. */
export function canCancelScheduledDeRisk(args: {
  requestedAt: Date
  now: Date
  typedConfirmation: string
}): { allowed: boolean; reason?: string; hoursRemaining?: number } {
  if (args.typedConfirmation !== 'CANCEL DE-RISK') {
    return { allowed: false, reason: 'typed confirmation required: CANCEL DE-RISK' }
  }
  const hours = (args.now.getTime() - args.requestedAt.getTime()) / 3_600_000
  if (hours < COOLING_OFF_HOURS) {
    return {
      allowed: false,
      reason: `cooling-off: ${Math.ceil(COOLING_OFF_HOURS - hours)}h remaining — executing the de-risk needs no wait; cancelling it does`,
      hoursRemaining: Math.ceil(COOLING_OFF_HOURS - hours),
    }
  }
  return { allowed: true }
}

/**
 * Panic circuit-breaker: user-initiated FULL liquidation of the Market bucket
 * during a >10% drawdown → show the projected cost of mistimed re-entry and
 * impose a 24h cool-down. Partial trims pass through.
 */
export function panicCircuitBreaker(args: {
  liquidationFraction: number
  currentDrawdownPct: number
  marketBucketUsd: number
  /** Behavior-gap estimate (fraction/yr), from kb_parameters. */
  behaviorGapRate: number
}): { blocked: boolean; coolDownHours: number; projectedCostUsd: number; message?: string } {
  const fullLiquidation = args.liquidationFraction >= 0.9
  const inDrawdown = args.currentDrawdownPct > PANIC_DRAWDOWN_THRESHOLD * 100
  if (!fullLiquidation || !inDrawdown) {
    return { blocked: false, coolDownHours: 0, projectedCostUsd: 0 }
  }
  const projectedCostUsd = Math.round(args.marketBucketUsd * args.behaviorGapRate)
  return {
    blocked: true,
    coolDownHours: COOLING_OFF_HOURS,
    projectedCostUsd,
    message:
      `Selling everything ${args.currentDrawdownPct.toFixed(0)}% below the peak is the classic ` +
      `behavior-gap trade — mistimed re-entry historically costs ≈$${projectedCostUsd.toLocaleString()}/yr ` +
      `on this balance. This order unlocks in ${COOLING_OFF_HOURS}h.`,
  }
}

/** Save More Tomorrow: +1%/yr contribution escalation, capped. */
export function nextContributionRate(
  currentRatePct: number,
  p: Pick<KbParameters, 'contribution_escalator_step_pct' | 'contribution_escalator_cap_pct'>
): number {
  const step = p.contribution_escalator_step_pct ?? 1
  const cap = p.contribution_escalator_cap_pct ?? 15
  return Math.min(cap, currentRatePct + step)
}
