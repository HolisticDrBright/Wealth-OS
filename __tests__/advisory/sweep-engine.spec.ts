/**
 * Sweep Engine — Knowledge Base §5–6 math, pinned to the primary sources.
 */

import { describe, it, expect } from 'vitest'
import {
  mertonShare,
  kellyDrawdownProbability,
  kellyMaxFraction,
  tippFloor,
  tippExposure,
  volBrakeExposure,
  bandBreached,
  deferralHurdle,
  evaluateSweepTriggers,
  planSweepFunding,
  routeSweepDestinations,
  canRefillSleeve,
  shouldWaitForLtcg,
  type SweepState,
  type SleeveState,
} from '@/lib/advisory/sweep-engine'
import type { KbParameters } from '@/lib/advisory/types'

const P: KbParameters = {
  tipp_cushion_alert_pct: 0.25,
  tipp_multiplier_equity: 3,
  tipp_multiplier_crypto: 2,
  vol_brake_threshold: 1.5,
  rebalance_band_relative: 0.20,
  bankroll_ratchet_multiple: 2,
  bankroll_ratchet_sweep_pct: 0.5,
}

function sleeve(overrides: Partial<SleeveState> = {}): SleeveState {
  return {
    key: 'crypto', valueUsd: 10_000, floorUsd: 8_000, peakCushionUsd: 4_000,
    initialBankrollUsd: 5_000, ratchetHwmUsd: 5_000,
    sigmaRealized: null, sigmaTarget: null,
    weightFraction: 0.05, tierCapFraction: 0.10, kellyCapFraction: null,
    suspended: false,
    ...overrides,
  }
}

function state(overrides: Partial<SweepState> = {}): SweepState {
  return {
    emergencyFundUsd: 50_000, emergencyTargetUsd: 45_000,
    tradingHalted: false, investableAssetsUsd: 200_000,
    sleeves: [sleeve()],
    headroom: { iraUsd: 0, hsaUsd: 0, solo401kUsd: 0, daysToDeadline: 200 },
    allocations: [],
    ...overrides,
  }
}

// ─── §5 math pinned to sources ───────────────────────────────────────────────

describe('Merton share (§5.1)', () => {
  it('γ=3, ERP 5%, σ 17% → ≈58% risky', () => {
    expect(mertonShare(0.05, 3, 0.17)).toBeCloseTo(0.577, 2)
  })
  it('clamps to [0, 1]', () => {
    expect(mertonShare(0.5, 1, 0.1)).toBe(1)
    expect(mertonShare(-0.02, 3, 0.17)).toBe(0)
  })
})

describe('Thorp drawdown formula (§5.2)', () => {
  it('full Kelly: 50% chance of ever halving; quarter: ~0.8%', () => {
    expect(kellyDrawdownProbability(0.5, 1)).toBeCloseTo(0.5, 10)
    expect(kellyDrawdownProbability(0.5, 0.5)).toBeCloseTo(0.125, 10)
    expect(kellyDrawdownProbability(0.5, 0.25)).toBeCloseTo(Math.pow(0.5, 7), 10)
  })
  it('kellyMaxFraction inverts it: ≤5% chance of 50% DD → c ≈ 0.376', () => {
    const c = kellyMaxFraction(0.5, 0.05)
    expect(c).toBeCloseTo(0.376, 3)
    // and the probability at that c is exactly the target
    expect(kellyDrawdownProbability(0.5, c)).toBeCloseTo(0.05, 10)
  })
})

describe('TIPP floor (§5.3)', () => {
  it('the floor only ever rises (ratchet)', () => {
    let f = tippFloor(0, 10_000, 0.85)          // 8,500
    expect(f).toBe(8_500)
    f = tippFloor(f, 12_000, 0.85)              // max(8500, 10200)
    expect(f).toBe(10_200)
    f = tippFloor(f, 9_000, 0.85)               // value fell — floor holds
    expect(f).toBe(10_200)
  })
  it('exposure → 0 as value approaches the floor; capped at value', () => {
    expect(tippExposure(12_000, 10_200, 3)).toBeCloseTo(5_400, 6)
    expect(tippExposure(10_200, 10_200, 3)).toBe(0)
    expect(tippExposure(10_100, 10_200, 3)).toBe(0)   // below floor
    expect(tippExposure(100_000, 0, 3)).toBe(100_000) // never above value
  })
})

describe('volatility brake (§5.4)', () => {
  it('1.5× target vol → cut exposure ~33%; never levers up', () => {
    expect(volBrakeExposure(0.20, 0.30)).toBeCloseTo(2 / 3, 10)
    expect(volBrakeExposure(0.20, 0.10)).toBe(1)      // calm ≠ leverage
  })
})

describe('rebalance bands (§5.5)', () => {
  it('20% relative band', () => {
    expect(bandBreached(0.125, 0.10, 0.20)).toBe(true)   // +25% drift
    expect(bandBreached(0.115, 0.10, 0.20)).toBe(false)  // +15% inside
  })
})

describe('deferral hurdle (§6.2)', () => {
  it('a 2×-cost position tolerates ~11% at 2026 top rates', () => {
    expect(deferralHurdle(0.5, 0.408, 0.238)).toBeCloseTo(0.1115, 3)
  })
  it('high-vol positions sweep now: expected move exceeds the hurdle', () => {
    const r = shouldWaitForLtcg({
      gainFraction: 0.5, annualizedVol: 0.8, daysToLtcg: 180,
      constants: { stcg_top_rate_with_niit: 0.408, ltcg_top_rate_with_niit: 0.238 },
    })
    expect(r.wait).toBe(false)  // 0.8 × √0.49 ≈ 56% expected move ≫ 11% hurdle
  })
})

// ─── §6.1 triggers ───────────────────────────────────────────────────────────

describe('evaluateSweepTriggers', () => {
  it('no triggers on a healthy state', () => {
    expect(evaluateSweepTriggers(state(), P)).toHaveLength(0)
  })

  it('1. liquidity breach outranks everything and allows STCG', () => {
    const s = state({ emergencyFundUsd: 20_000, emergencyTargetUsd: 45_000 })
    const actions = evaluateSweepTriggers(s, P)
    expect(actions[0].trigger).toBe('liquidity_breach')
    expect(actions[0].allowStcg).toBe(true)
    expect(actions[0].amountUsd).toBe(10_000)  // capped by sleeve value
  })

  it('2. halt de-risks every sleeve to its floor', () => {
    const s = state({ tradingHalted: true })
    const actions = evaluateSweepTriggers(s, P)
    expect(actions[0].trigger).toBe('halt')
    expect(actions[0].amountUsd).toBe(2_000)  // 10k − 8k floor
  })

  it('3. TIPP: cushion below 25% of peak cushion → de-risk toward floor', () => {
    // cushion = 10,500 − 10,000 = 500 < 25% × 4,000
    const s = state({ sleeves: [sleeve({ valueUsd: 10_500, floorUsd: 10_000 })] })
    const actions = evaluateSweepTriggers(s, P)
    expect(actions[0].trigger).toBe('tipp_floor')
    // target exposure = m=2 (crypto) × 500 = 1,000 → sweep 10,500 − max(1000, 10000)
    expect(actions[0].amountUsd).toBe(500)
  })

  it('4. vol brake cuts proportionally, never realizes STCG', () => {
    const s = state({ sleeves: [sleeve({ sigmaRealized: 0.60, sigmaTarget: 0.30, floorUsd: 0, peakCushionUsd: 0 })] })
    const actions = evaluateSweepTriggers(s, P)
    expect(actions[0].trigger).toBe('vol_brake')
    expect(actions[0].amountUsd).toBeCloseTo(10_000 * 0.5, 6)
    expect(actions[0].allowStcg).toBe(false)
  })

  it('5. bankroll ratchet sweeps 50% of profits above 2× bankroll', () => {
    const s = state({ sleeves: [sleeve({ valueUsd: 14_000, floorUsd: 0, peakCushionUsd: 0 })] })
    const actions = evaluateSweepTriggers(s, P)
    expect(actions[0].trigger).toBe('bankroll_ratchet')
    // mark = 10k; profits above = 4k; sweep 2k
    expect(actions[0].amountUsd).toBe(2_000)
  })

  it('6. cap breach harvests back to the tier/Kelly cap', () => {
    // initialBankroll high enough that the ratchet (priority 5) stays quiet
    const s = state({ sleeves: [sleeve({ weightFraction: 0.15, floorUsd: 0, peakCushionUsd: 0, valueUsd: 30_000, initialBankrollUsd: 30_000 })] })
    const actions = evaluateSweepTriggers(s, P)
    expect(actions[0].trigger).toBe('cap_breach')
    expect(actions[0].amountUsd).toBeCloseTo(0.05 * 200_000, 6)
  })

  it('7. band rebalance emits trade-to-band-edge only', () => {
    const s = state({
      allocations: [{ assetClass: 'crypto', currentWeight: 0.14, targetWeight: 0.10 }],
    })
    const actions = evaluateSweepTriggers(s, P)
    expect(actions[0].trigger).toBe('band_rebalance')
    // edge = 0.10 × 1.2 = 0.12 → sweep (0.14 − 0.12) × 200k = 4k
    expect(actions[0].amountUsd).toBeCloseTo(4_000, 6)
  })

  it('8. headroom calendar fires inside 90 days with unfilled room', () => {
    const s = state({
      headroom: { iraUsd: 7_500, hsaUsd: 4_400, solo401kUsd: 0, daysToDeadline: 45 },
    })
    const actions = evaluateSweepTriggers(s, P)
    expect(actions[0].trigger).toBe('headroom_calendar')
    expect(actions[0].amountUsd).toBe(10_000)  // capped by sleeve value
  })

  it('higher triggers claim a sleeve — no double-sweeping', () => {
    const s = state({
      tradingHalted: true,
      sleeves: [sleeve({ valueUsd: 14_000 })],  // would also hit the ratchet
    })
    const actions = evaluateSweepTriggers(s, P)
    const forCrypto = actions.filter(a => a.sleeveKey === 'crypto')
    expect(forCrypto).toHaveLength(1)
    expect(forCrypto[0].trigger).toBe('halt')
  })
})

// ─── §6.2 funding + §6.3 routing ─────────────────────────────────────────────

describe('planSweepFunding', () => {
  const lots = [
    { kind: 'stcg' as const, amountUsd: 5_000, gainFraction: 0.5 },
    { kind: 'new_contributions' as const, amountUsd: 1_000 },
    { kind: 'loss_lot' as const, amountUsd: 2_000 },
    { kind: 'high_basis_ltcg' as const, amountUsd: 3_000 },
    { kind: 'tax_advantaged' as const, amountUsd: 1_500 },
  ]

  it('funds cheapest-tax-first: contributions → tax-advantaged → losses → high-basis → STCG', () => {
    const { plan } = planSweepFunding(7_000, lots, true)
    expect(plan.map(p => p.kind)).toEqual([
      'new_contributions', 'tax_advantaged', 'loss_lot', 'high_basis_ltcg',
    ])
    expect(plan.reduce((s, p) => s + p.useUsd, 0)).toBe(7_000)
  })

  it('STCG only when the trigger forces it', () => {
    const soft = planSweepFunding(10_000, lots, false)
    expect(soft.plan.some(p => p.kind === 'stcg')).toBe(false)
    expect(soft.shortfallUsd).toBe(2_500)

    const forced = planSweepFunding(10_000, lots, true)
    expect(forced.plan.some(p => p.kind === 'stcg')).toBe(true)
    expect(forced.shortfallUsd).toBe(0)
  })
})

describe('routeSweepDestinations', () => {
  it('enters the waterfall at the highest unfilled step', () => {
    const dests = routeSweepDestinations(20_000, {
      emergencyFundUsd: 40_000, emergencyTargetUsd: 45_000,
      headroom: { iraUsd: 7_500, hsaUsd: 4_400, solo401kUsd: 10_000, daysToDeadline: 200 },
    })
    expect(dests.map(d => d.destination)).toEqual(['emergency_fund', 'hsa', 'roth_ira', 'solo401k'])
    expect(dests.map(d => d.amountUsd)).toEqual([5_000, 4_400, 7_500, 3_100])
  })

  it('everything current → taxable index core', () => {
    const dests = routeSweepDestinations(10_000, {
      emergencyFundUsd: 45_000, emergencyTargetUsd: 45_000,
      headroom: { iraUsd: 0, hsaUsd: 0, solo401kUsd: 0, daysToDeadline: 200 },
    })
    expect(dests).toEqual([expect.objectContaining({ destination: 'taxable_core', amountUsd: 10_000 })])
  })
})

describe('canRefillSleeve (§6.4)', () => {
  const ok = {
    emergencyFundUsd: 45_000, emergencyTargetUsd: 45_000, waterfallCurrent: true,
    sleeveWeightFraction: 0.05, tierCapFraction: 0.10, userReconfirmedWithinQuarter: true,
  }
  it('all conditions required', () => {
    expect(canRefillSleeve(ok).allowed).toBe(true)
    expect(canRefillSleeve({ ...ok, emergencyFundUsd: 40_000 }).allowed).toBe(false)
    expect(canRefillSleeve({ ...ok, waterfallCurrent: false }).allowed).toBe(false)
    expect(canRefillSleeve({ ...ok, sleeveWeightFraction: 0.10 }).allowed).toBe(false)
    expect(canRefillSleeve({ ...ok, userReconfirmedWithinQuarter: false }).allowed).toBe(false)
  })
})
