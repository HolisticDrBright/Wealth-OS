import { describe, it, expect } from 'vitest'
import { getEffectiveStrategies } from '@/lib/strategies/profile-params'
import type { UserRiskProfile } from '@/lib/strategies/profile-params'

const mk = (overrides: Partial<UserRiskProfile> = {}): UserRiskProfile => ({
  userId: 'u1', profileKey: 'balanced', uiMode: 'basic',
  customStrategyOverrides: {}, customParamOverrides: {},
  assetClassOverrides: {}, autoExecuteThresholdUsd: null, onboardedAt: null,
  ...overrides,
})

describe('Integration smoke — getEffectiveStrategies', () => {
  it('vault: only base strategies enabled', () => {
    const s = getEffectiveStrategies(mk({ profileKey: 'vault' }))
    expect(s.size).toBe(9)  // 6 original + pendle_pt_fixed_yield, month_end_fix, cross_platform_sports_arb
    expect(s.has('dividend_aristocrat')).toBe(true)
    expect(s.has('memecoin_bondingcurve')).toBe(false)
    expect(s.has('vcp_minervini')).toBe(false)
  })

  it('speculative: all strategies enabled', () => {
    const s = getEffectiveStrategies(mk({ profileKey: 'speculative' }))
    expect(s.size).toBe(58)  // 51 original + 7 new speculative-eligible strategies
    expect(s.has('memecoin_bondingcurve')).toBe(true)
    expect(s.has('polymarket_triangle_arb')).toBe(true)
  })

  it('advanced: override enables memecoin on balanced', () => {
    const s = getEffectiveStrategies(mk({
      uiMode: 'advanced',
      customStrategyOverrides: { memecoin_bondingcurve: true },
    }))
    expect(s.has('memecoin_bondingcurve')).toBe(true)
  })

  it('advanced: asset-class exclusion beats strategy override', () => {
    const s = getEffectiveStrategies(mk({
      profileKey: 'speculative', uiMode: 'advanced',
      customStrategyOverrides: { polymarket_wallet_copy: true },
      assetClassOverrides: { polymarket: false },
    }))
    expect(s.has('polymarket_wallet_copy')).toBe(false)
  })

  it('basic: asset-class exclusion works without overrides', () => {
    const s = getEffectiveStrategies(mk({
      profileKey: 'speculative', uiMode: 'basic',
      assetClassOverrides: { crypto: false },
    }))
    expect(s.has('memecoin_bondingcurve')).toBe(false)
    expect(s.has('dividend_aristocrat')).toBe(true)
  })

  it('conservative: includes sector_rotation, excludes vcp_minervini', () => {
    const s = getEffectiveStrategies(mk({ profileKey: 'conservative' }))
    expect(s.has('sector_rotation')).toBe(true)
    expect(s.has('vcp_minervini')).toBe(false)
  })

  it('growth: includes vcp_minervini and liquidation_hunting', () => {
    const s = getEffectiveStrategies(mk({ profileKey: 'growth' }))
    expect(s.has('vcp_minervini')).toBe(true)
    expect(s.has('liquidation_hunting')).toBe(true)
    expect(s.has('memecoin_bondingcurve')).toBe(false)
  })
})
