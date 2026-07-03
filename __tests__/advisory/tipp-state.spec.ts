/**
 * Persisted TIPP floor state (Remaining brief R2).
 */

import { describe, it, expect } from 'vitest'
import { updateFloorState, resetFloorState, RESET_PHRASE } from '@/lib/advisory/tipp-state'
import { tippExposure, evaluateSweepTriggers } from '@/lib/advisory/sweep-engine'
import type { KbParameters } from '@/lib/advisory/types'

const ZERO = { floorUsd: 0, hwmUsd: 0, peakCushionUsd: 0 }

describe('updateFloorState', () => {
  it('ratchets UP on gains and HOLDS on losses', () => {
    let s = updateFloorState(ZERO, 10_000, 0.85, 0, 1)
    expect(s.floorUsd).toBe(8_500)
    s = updateFloorState(s, 14_000, 0.85, 0, 1)        // gain → floor rises
    expect(s.floorUsd).toBeCloseTo(11_900, 6)
    const afterLoss = updateFloorState(s, 9_000, 0.85, 0, 1)  // loss → floor holds
    expect(afterLoss.floorUsd).toBeCloseTo(11_900, 6)
    expect(afterLoss.hwmUsd).toBe(14_000)
  })

  it('compounds the floor at the risk-free rate between updates', () => {
    const s = updateFloorState({ ...ZERO, floorUsd: 10_000 }, 5_000, 0.85, 0.0365, 10)
    expect(s.floorUsd).toBeCloseTo(10_000 * Math.exp(0.0365 * 10 / 365), 6)
  })

  it('tracks peak cushion for the sweep trigger', () => {
    let s = updateFloorState(ZERO, 10_000, 0.85, 0, 1)   // cushion 1,500
    expect(s.peakCushionUsd).toBe(1_500)
    s = updateFloorState(s, 9_000, 0.85, 0, 1)           // cushion shrinks, peak holds
    expect(s.peakCushionUsd).toBe(1_500)
  })
})

describe('cushion→exposure math at both multipliers', () => {
  it('m=3 (equity/fx) and m=2 (crypto/PM)', () => {
    expect(tippExposure(12_000, 10_000, 3)).toBe(6_000)
    expect(tippExposure(12_000, 10_000, 2)).toBe(4_000)
  })
})

describe('resetFloorState', () => {
  it('requires the typed phrase and a reason; produces a log entry', () => {
    expect('error' in resetFloorState('nope', 'why', 10_000, 0.85)).toBe(true)
    expect('error' in resetFloorState(RESET_PHRASE, '', 10_000, 0.85)).toBe(true)
    const r = resetFloorState(RESET_PHRASE, 'rebased after deposit', 10_000, 0.85)
    if ('error' in r) throw new Error('expected success')
    expect(r.state.floorUsd).toBe(8_500)
    expect(r.logEntry.reason).toBe('rebased after deposit')
  })
})

describe('e2e: gain → ratchet → drawdown → sweep de-risk recommendation', () => {
  const P: KbParameters = {
    tipp_cushion_alert_pct: 0.25, tipp_multiplier_equity: 3, tipp_multiplier_crypto: 2,
    vol_brake_threshold: 1.5, rebalance_band_relative: 0.2,
    bankroll_ratchet_multiple: 2, bankroll_ratchet_sweep_pct: 0.5,
  }

  it('persisted floor state drives the TIPP trigger after a drawdown', () => {
    // Sleeve runs 10k → 14k (floor ratchets to 11.9k, peak cushion 2.1k),
    // then draws down to 12.2k: cushion 300 < 25% × 2.1k → de-risk.
    let s = updateFloorState(ZERO, 10_000, 0.85, 0, 1)
    s = updateFloorState(s, 14_000, 0.85, 0, 1)
    s = updateFloorState(s, 12_200, 0.85, 0, 1)

    const actions = evaluateSweepTriggers({
      emergencyFundUsd: 50_000, emergencyTargetUsd: 45_000,
      tradingHalted: false, investableAssetsUsd: 200_000,
      sleeves: [{
        key: 'crypto', valueUsd: 12_200,
        floorUsd: s.floorUsd, peakCushionUsd: s.peakCushionUsd,
        initialBankrollUsd: 0, ratchetHwmUsd: s.hwmUsd,
        sigmaRealized: null, sigmaTarget: null,
        weightFraction: 0.06, tierCapFraction: 0.10, kellyCapFraction: null,
        suspended: false,
      }],
      headroom: { iraUsd: 0, hsaUsd: 0, solo401kUsd: 0, daysToDeadline: 200 },
      allocations: [],
    }, P)

    expect(actions[0]?.trigger).toBe('tipp_floor')
    expect(actions[0].amountUsd).toBeGreaterThan(0)
  })
})
