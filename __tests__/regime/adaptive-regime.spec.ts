/**
 * Adaptive regime thresholds — tighten-only invariants.
 *
 * The core safety property: adaptation may only make the system MORE cautious
 * (lower trigger levels = earlier RISK_OFF/CRISIS), never less. Fixed levels
 * are ceilings; floors stop a calm year from over-triggering.
 */

import { describe, it, expect } from 'vitest'
import {
  computeAdaptiveThresholds, classifyRegime, FIXED_THRESHOLDS, CrossAssetRegime,
} from '@/lib/regime/cross-asset-regime'

function vixSeries(base: number, n = 252): number[] {
  // Deterministic wiggle around a base level
  return Array.from({ length: n }, (_, i) => base + Math.sin(i / 7) * 3)
}

describe('computeAdaptiveThresholds', () => {
  it('falls back to fixed thresholds with insufficient history', () => {
    expect(computeAdaptiveThresholds([])).toEqual(FIXED_THRESHOLDS)
    expect(computeAdaptiveThresholds(vixSeries(18, 30))).toEqual(FIXED_THRESHOLDS)
  })

  it('never raises thresholds above the fixed ceilings', () => {
    // Very high-vol year: percentiles way above 30/40 — must clamp to fixed
    const t = computeAdaptiveThresholds(vixSeries(45))
    expect(t.riskOffVix).toBeLessThanOrEqual(FIXED_THRESHOLDS.riskOffVix)
    expect(t.crisisVix).toBeLessThanOrEqual(FIXED_THRESHOLDS.crisisVix)
  })

  it('tightens thresholds in an elevated-vol year (earlier caution)', () => {
    // Base 26: p80 ≈ 28-29 → riskOff tightens below 30
    const t = computeAdaptiveThresholds(vixSeries(26))
    expect(t.riskOffVix).toBeLessThan(FIXED_THRESHOLDS.riskOffVix)
    expect(t.adaptive).toBe(true)
  })

  it('respects floors in a very calm year — no crying wolf', () => {
    const t = computeAdaptiveThresholds(vixSeries(12))
    expect(t.riskOffVix).toBeGreaterThanOrEqual(24)
    expect(t.crisisVix).toBeGreaterThanOrEqual(32)
  })

  it('ignores non-finite and non-positive values', () => {
    const dirty = [...vixSeries(26), NaN, Infinity, -5, 0]
    const clean = computeAdaptiveThresholds(vixSeries(26))
    expect(computeAdaptiveThresholds(dirty)).toEqual(clean)
  })
})

describe('classifyRegime', () => {
  it('applies the fixed rules: CRISIS / RISK_OFF / RISK_ON / NEUTRAL', () => {
    expect(classifyRegime(42, 350)).toBe(CrossAssetRegime.CRISIS)
    expect(classifyRegime(22, 850)).toBe(CrossAssetRegime.CRISIS)
    expect(classifyRegime(32, 400)).toBe(CrossAssetRegime.RISK_OFF)
    expect(classifyRegime(15, 300)).toBe(CrossAssetRegime.RISK_ON)
    expect(classifyRegime(25, 450)).toBe(CrossAssetRegime.NEUTRAL)
  })

  it('credit leg works in basis points (the percent-vs-bps bug is fixed)', () => {
    // FRED reports 8.5 (percent). Converted to 850 bps → CRISIS.
    // The old code compared 8.5 >= 800 — never true.
    expect(classifyRegime(18, 8.5 * 100)).toBe(CrossAssetRegime.CRISIS)
    expect(classifyRegime(18, 6.2 * 100)).toBe(CrossAssetRegime.RISK_OFF)
  })

  it('tightened thresholds trigger RISK_OFF earlier', () => {
    const tightened = { riskOffVix: 26, crisisVix: 34, adaptive: true }
    // VIX 27: NEUTRAL under fixed rules, RISK_OFF under tightened
    expect(classifyRegime(27, 300)).toBe(CrossAssetRegime.NEUTRAL)
    expect(classifyRegime(27, 300, tightened)).toBe(CrossAssetRegime.RISK_OFF)
    // VIX 35: RISK_OFF under fixed, CRISIS under tightened
    expect(classifyRegime(35, 300)).toBe(CrossAssetRegime.RISK_OFF)
    expect(classifyRegime(35, 300, tightened)).toBe(CrossAssetRegime.CRISIS)
  })

  it('handles missing data without false RISK_ON', () => {
    // No VIX → can't assert risk-on
    expect(classifyRegime(null, 300)).toBe(CrossAssetRegime.NEUTRAL)
    // No OAS but calm VIX → RISK_ON allowed (VIX is the primary signal)
    expect(classifyRegime(15, null)).toBe(CrossAssetRegime.RISK_ON)
  })
})
