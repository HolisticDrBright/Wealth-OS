/**
 * Personalization layer (R8): honest counterfactual math + monotonic
 * bounded guardrail strictness.
 */

import { describe, it, expect } from 'vitest'
import { computeBehaviorGap, guardrailStrictness, type BehaviorEvent } from '@/lib/personalization/behavior'

const now = Date.now()
const ev = (event: BehaviorEvent['event'], delta: number | null, daysAgo = 10): BehaviorEvent =>
  ({ event, outcomeUsdDelta: delta, ts: new Date(now - daysAgo * 86_400_000).toISOString() })

describe('computeBehaviorGap', () => {
  it('sums realized-vs-counterfactual honestly — costs', () => {
    const r = computeBehaviorGap([
      ev('cancel_derisk', -1_200), ev('panic_liquidation', -840), ev('override_sweep', 200),
    ], 365, now)
    expect(r.gapUsd).toBe(-1_840)
    expect(r.headline).toContain('cost you $1,840')
    expect(r.byEvent.cancel_derisk.gapUsd).toBe(-1_200)
  })

  it('…and gains, honestly signed the other way', () => {
    const r = computeBehaviorGap([ev('manual_trade_override', 600)], 365, now)
    expect(r.gapUsd).toBe(600)
    expect(r.headline).toContain('made you $600')
  })

  it('ungraded events counted but excluded from the dollar gap; window respected', () => {
    const r = computeBehaviorGap([
      ev('ignore_recommendation', null, 5),
      ev('cancel_derisk', -500, 400),
    ], 365, now)
    expect(r.events).toBe(1)
    expect(r.graded).toBe(0)
    expect(r.gapUsd).toBe(0)
    expect(r.headline).toContain('No graded overrides')
  })
})

describe('guardrailStrictness', () => {
  const P = { baseCooldownHours: 24, maxMultiplier: 3, lossAtMaxUsd: 5_000 }

  it('monotonic in measured losses, bounded at the cap', () => {
    const none = guardrailStrictness(0, P)
    const some = guardrailStrictness(-2_500, P)
    const max = guardrailStrictness(-5_000, P)
    const beyond = guardrailStrictness(-50_000, P)
    expect(none.multiplier).toBe(1)
    expect(some.multiplier).toBeGreaterThan(none.multiplier)
    expect(max.multiplier).toBe(3)
    expect(beyond.multiplier).toBe(3)
    expect(beyond.cooldownHours).toBe(72)
  })

  it('gains never reduce friction below baseline', () => {
    expect(guardrailStrictness(10_000, P).multiplier).toBe(1)
  })
})
