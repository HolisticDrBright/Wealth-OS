/**
 * Compounding personalization (Remaining brief R8) — learn each user.
 * Behavior gap = realized minus the if-followed counterfactual, HONESTLY
 * signed both ways ("your overrides cost $1,840" or "made $600").
 * Guardrail strictness scales monotonically with measured override losses,
 * bounded by kb_parameters — never punitive beyond the cap.
 */

export interface BehaviorEvent {
  event: 'override_sweep' | 'cancel_derisk' | 'panic_liquidation' | 'ignore_recommendation' | 'manual_trade_override'
  outcomeUsdDelta: number | null   // realized − counterfactual (negative = cost)
  ts: string
}

export interface BehaviorGapReport {
  windowDays: number
  events: number
  graded: number
  /** Negative = the user's overrides COST this much vs following the system. */
  gapUsd: number
  byEvent: Record<string, { count: number; gapUsd: number }>
  headline: string
}

export function computeBehaviorGap(events: BehaviorEvent[], windowDays = 365, now = Date.now()): BehaviorGapReport {
  const cutoff = now - windowDays * 86_400_000
  const inWindow = events.filter(e => new Date(e.ts).getTime() >= cutoff)
  const graded = inWindow.filter(e => e.outcomeUsdDelta != null)
  const gapUsd = Math.round(graded.reduce((s, e) => s + (e.outcomeUsdDelta ?? 0), 0))

  const byEvent: BehaviorGapReport['byEvent'] = {}
  for (const e of graded) {
    const cur = byEvent[e.event] ?? { count: 0, gapUsd: 0 }
    cur.count += 1
    cur.gapUsd += e.outcomeUsdDelta ?? 0
    byEvent[e.event] = cur
  }
  for (const k of Object.keys(byEvent)) byEvent[k].gapUsd = Math.round(byEvent[k].gapUsd)

  const headline = graded.length === 0
    ? 'No graded overrides this period — nothing to report.'
    : gapUsd < 0
      ? `Your overrides cost you $${Math.abs(gapUsd).toLocaleString()} this period vs following the system.`
      : `Your overrides made you $${gapUsd.toLocaleString()} this period — honestly counted.`

  return { windowDays, events: inWindow.length, graded: graded.length, gapUsd, byEvent, headline }
}

export interface StrictnessParams {
  /** Base cool-down hours (KB §8 default 24). */
  baseCooldownHours: number
  /** Max multiplier on friction, bounded (kb_parameters). */
  maxMultiplier: number
  /** Losses at which friction reaches the cap. */
  lossAtMaxUsd: number
}

/**
 * Guardrail strictness scales with MEASURED override losses:
 * multiplier = 1 + (maxMultiplier − 1) × min(1, losses/lossAtMax).
 * Gains never reduce friction below baseline. Monotonic and bounded.
 */
export function guardrailStrictness(
  measuredGapUsd: number,
  p: StrictnessParams
): { multiplier: number; cooldownHours: number } {
  const losses = Math.max(0, -measuredGapUsd)
  const frac = p.lossAtMaxUsd > 0 ? Math.min(1, losses / p.lossAtMaxUsd) : 0
  const multiplier = Math.round((1 + (p.maxMultiplier - 1) * frac) * 100) / 100
  return { multiplier, cooldownHours: Math.round(p.baseCooldownHours * multiplier) }
}
