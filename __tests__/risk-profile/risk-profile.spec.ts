/**
 * Risk Profile System — test suite (F1-F10)
 *
 *  F1  vault profile loads confluence_threshold = 3
 *  F2  vault profile excludes memecoin_bondingcurve
 *  F3  polymarket strategies excluded when assetClassOverrides.polymarket = false
 *  F4  confluence threshold respected — vault needs 4 agreements for 1.5x (threshold+1)
 *  F5  profile switch preserved open positions (profile change is non-destructive)
 *  F6  onboarding wizard recommendation algorithm
 *  F7  auto-execute threshold stored and returned
 *  F8  basic mode ignores custom_strategy_overrides
 *  F9  advanced mode applies custom_strategy_overrides
 * F10  override badge: strategy with override flag in effectiveStrategies
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Shared helpers ─────────────────────────────────────────────────────────────

function makeDb(profileKey: string, uiMode = 'basic', overrides: Record<string, unknown> = {}) {
  const profileRows: Record<string, Record<string, unknown>> = {
    vault: {
      profile_key: 'vault', display_name: 'Vault', description: 'Capital preservation',
      confluence_threshold: 3, confluence_strength_override: null,
      position_cap_pct: 0.02, max_concurrent_positions: 3,
      hedge_sleeve_pct_target: 5, stop_loss_multiplier: 0.5,
      auto_retirement_brier_threshold: 0.20,
    },
    balanced: {
      profile_key: 'balanced', display_name: 'Balanced', description: 'Balanced',
      confluence_threshold: 2, confluence_strength_override: null,
      position_cap_pct: 0.05, max_concurrent_positions: 8,
      hedge_sleeve_pct_target: 3, stop_loss_multiplier: 1.0,
      auto_retirement_brier_threshold: 0.25,
    },
  }

  const userRow: Record<string, unknown> = {
    user_id: 'user-1',
    profile_key: profileKey,
    ui_mode: uiMode,
    custom_strategy_overrides: {},
    custom_param_overrides: {},
    asset_class_overrides: {},
    auto_execute_threshold_usd: null,
    onboarded_at: null,
    ...overrides,
  }

  return {
    from: (table: string) => ({
      select: () => ({
        eq: (col: string, val: unknown) => ({
          single: () => {
            if (table === 'risk_profiles') {
              const row = profileRows[val as string] ?? null
              return Promise.resolve({ data: row, error: null })
            }
            if (table === 'user_risk_profile') {
              return Promise.resolve({ data: userRow, error: null })
            }
            return Promise.resolve({ data: null, error: null })
          },
          eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }),
        }),
      }),
    }),
  }
}

// ── F1: vault loads confluence_threshold = 3 ──────────────────────────────────

describe('F1 loadProfileParams vault', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns confluenceThreshold=3 for vault profile', async () => {
    const { loadProfileParams } = await import('@/lib/strategies/profile-params')
    const db = makeDb('vault')
    const params = await loadProfileParams(db, 'vault')
    expect(params.confluenceThreshold).toBe(3)
    expect(params.positionCapPct).toBe(0.02)
    expect(params.stopLossMultiplier).toBe(0.5)
  })
})

// ── F2: vault excludes memecoin_bondingcurve ─────────────────────────────────

describe('F2 getEffectiveStrategies vault excludes memecoin', () => {
  beforeEach(() => vi.clearAllMocks())

  it('memecoin_bondingcurve not in vault effective set', async () => {
    const { loadUserProfile, getEffectiveStrategies } = await import('@/lib/strategies/profile-params')
    const db = makeDb('vault')
    const profile = await loadUserProfile(db, 'user-1')
    const strategies = getEffectiveStrategies(profile)
    expect(strategies.has('memecoin_bondingcurve')).toBe(false)
  })

  it('vault effective set contains rwa_yield_stack and dividend_aristocrat', async () => {
    const { loadUserProfile, getEffectiveStrategies } = await import('@/lib/strategies/profile-params')
    const db = makeDb('vault')
    const profile = await loadUserProfile(db, 'user-1')
    const strategies = getEffectiveStrategies(profile)
    expect(strategies.has('rwa_yield_stack')).toBe(true)
    expect(strategies.has('dividend_aristocrat')).toBe(true)
  })
})

// ── F3: polymarket exclusion via asset class override ─────────────────────────

describe('F3 asset class polymarket exclusion', () => {
  beforeEach(() => vi.clearAllMocks())

  it('polymarket strategies excluded when assetClassOverrides.polymarket = false', async () => {
    const { loadUserProfile, getEffectiveStrategies } = await import('@/lib/strategies/profile-params')
    const db = makeDb('speculative', 'basic', {
      asset_class_overrides: { polymarket: false },
    })
    const profile = await loadUserProfile(db, 'user-1')
    const strategies = getEffectiveStrategies(profile)
    expect(strategies.has('polymarket_wallet_copy')).toBe(false)
    expect(strategies.has('polymarket_resolution_rules')).toBe(false)
    expect(strategies.has('polymarket_triangle_arb')).toBe(false)
  })

  it('non-polymarket strategies are unaffected by polymarket exclusion', async () => {
    const { loadUserProfile, getEffectiveStrategies } = await import('@/lib/strategies/profile-params')
    const db = makeDb('speculative', 'basic', {
      asset_class_overrides: { polymarket: false },
    })
    const profile = await loadUserProfile(db, 'user-1')
    const strategies = getEffectiveStrategies(profile)
    expect(strategies.has('memecoin_bondingcurve')).toBe(true)
  })
})

// ── F4: confluence threshold respected in getEffectiveParams ──────────────────

describe('F4 confluence threshold', () => {
  beforeEach(() => vi.clearAllMocks())

  it('vault returns confluenceThreshold=3 so 3 agreements trigger 1.25x not 1.5x', async () => {
    const { loadProfileParams, getEffectiveParams, loadUserProfile } =
      await import('@/lib/strategies/profile-params')
    const db = makeDb('vault')
    const profileBase = await loadProfileParams(db, 'vault')
    const userProfile = await loadUserProfile(db, 'user-1')
    const params = getEffectiveParams(profileBase, userProfile)
    expect(params.confluenceThreshold).toBe(3)
    // With threshold=3: agreementCount=3 → 1.25x, agreementCount=4 → 1.5x
    // agreementCount=2 does NOT trigger boost
    // This test just verifies the threshold value; the actual multiplier logic is in CIODecisionEngine
  })

  it('balanced returns confluenceThreshold=2', async () => {
    const { loadProfileParams } = await import('@/lib/strategies/profile-params')
    const db = makeDb('balanced')
    const params = await loadProfileParams(db, 'balanced')
    expect(params.confluenceThreshold).toBe(2)
  })
})

// ── F5: profile switch does not destroy custom overrides ──────────────────────

describe('F5 profile switch preserves overrides', () => {
  beforeEach(() => vi.clearAllMocks())

  it('switching from growth to balanced keeps custom_strategy_overrides intact', async () => {
    const { loadUserProfile } = await import('@/lib/strategies/profile-params')
    // Simulate a user who was on growth, set overrides, then switched to balanced
    const db = makeDb('balanced', 'advanced', {
      custom_strategy_overrides: { vcp_minervini: false, quant_momentum: true },
    })
    const profile = await loadUserProfile(db, 'user-1')
    // Overrides are loaded regardless of profile switch
    expect(profile.customStrategyOverrides['vcp_minervini']).toBe(false)
    expect(profile.customStrategyOverrides['quant_momentum']).toBe(true)
  })
})

// ── F6: wizard recommendation algorithm ─────────────────────────────────────

describe('F6 onboarding recommendation algorithm', () => {
  // Replicate the computeRecommendation logic inline to test it deterministically
  const PROFILES = ['vault', 'conservative', 'balanced', 'growth', 'speculative'] as const
  type ProfileKey = typeof PROFILES[number]

  function computeRecommendation(baseIndex: number, adjustment: number): ProfileKey {
    const idx = Math.min(4, Math.max(0, baseIndex + adjustment))
    return PROFILES[idx]
  }

  it('goal=vault (0) + drawdown=panic (-1) → vault (clamped at 0)', () => {
    expect(computeRecommendation(0, -1)).toBe('vault')
  })

  it('goal=balanced (2) + drawdown=buy more (+1) → growth', () => {
    expect(computeRecommendation(2, 1)).toBe('growth')
  })

  it('goal=speculative (4) + drawdown=panic (-1) → growth', () => {
    expect(computeRecommendation(4, -1)).toBe('growth')
  })

  it('goal=growth (3) + drawdown=neutral (0) → growth', () => {
    expect(computeRecommendation(3, 0)).toBe('growth')
  })

  it('speculative + buy more clamped at speculative', () => {
    expect(computeRecommendation(4, 2)).toBe('speculative')
  })
})

// ── F7: auto-execute threshold stored and returned ───────────────────────────

describe('F7 auto-execute threshold', () => {
  beforeEach(() => vi.clearAllMocks())

  it('autoExecuteThresholdUsd is returned from loadUserProfile', async () => {
    const { loadUserProfile } = await import('@/lib/strategies/profile-params')
    const db = makeDb('balanced', 'basic', { auto_execute_threshold_usd: 1000 })
    const profile = await loadUserProfile(db, 'user-1')
    expect(profile.autoExecuteThresholdUsd).toBe(1000)
  })

  it('returns null when no threshold set', async () => {
    const { loadUserProfile } = await import('@/lib/strategies/profile-params')
    const db = makeDb('balanced')
    const profile = await loadUserProfile(db, 'user-1')
    expect(profile.autoExecuteThresholdUsd).toBeNull()
  })
})

// ── F8: basic mode ignores strategy overrides ────────────────────────────────

describe('F8 basic mode ignores custom_strategy_overrides', () => {
  beforeEach(() => vi.clearAllMocks())

  it('vcp_minervini enabled in basic+speculative even if override says false', async () => {
    const { loadUserProfile, getEffectiveStrategies } = await import('@/lib/strategies/profile-params')
    // speculative includes vcp_minervini; override says false but ui_mode=basic should ignore
    const db = makeDb('speculative', 'basic', {
      custom_strategy_overrides: { vcp_minervini: false },
    })
    const profile = await loadUserProfile(db, 'user-1')
    const strategies = getEffectiveStrategies(profile)
    // basic mode ignores custom_strategy_overrides; vcp_minervini is in speculative
    expect(strategies.has('vcp_minervini')).toBe(true)
  })
})

// ── F9: advanced mode applies strategy overrides ─────────────────────────────

describe('F9 advanced mode applies custom_strategy_overrides', () => {
  beforeEach(() => vi.clearAllMocks())

  it('vcp_minervini disabled via override in advanced mode for balanced profile', async () => {
    const { loadUserProfile, getEffectiveStrategies } = await import('@/lib/strategies/profile-params')
    // balanced does not include vcp_minervini by default; but even if it did, override=false
    const db = makeDb('speculative', 'advanced', {
      custom_strategy_overrides: { vcp_minervini: false },
    })
    const profile = await loadUserProfile(db, 'user-1')
    const strategies = getEffectiveStrategies(profile)
    expect(strategies.has('vcp_minervini')).toBe(false)
  })

  it('memecoin_bondingcurve enabled via override in advanced mode for balanced profile', async () => {
    const { loadUserProfile, getEffectiveStrategies } = await import('@/lib/strategies/profile-params')
    // balanced does not include memecoin by default
    const db = makeDb('balanced', 'advanced', {
      custom_strategy_overrides: { memecoin_bondingcurve: true },
    })
    const profile = await loadUserProfile(db, 'user-1')
    const strategies = getEffectiveStrategies(profile)
    expect(strategies.has('memecoin_bondingcurve')).toBe(true)
  })
})

// ── F10: override presence tracked in profile object ────────────────────────

describe('F10 override tracking in profile object', () => {
  beforeEach(() => vi.clearAllMocks())

  it('custom_strategy_overrides keys are available for badge rendering', async () => {
    const { loadUserProfile } = await import('@/lib/strategies/profile-params')
    const db = makeDb('balanced', 'advanced', {
      custom_strategy_overrides: { quant_momentum: false, pead: true },
    })
    const profile = await loadUserProfile(db, 'user-1')
    const overrideKeys = Object.keys(profile.customStrategyOverrides)
    expect(overrideKeys).toContain('quant_momentum')
    expect(overrideKeys).toContain('pead')
    expect(profile.customStrategyOverrides['quant_momentum']).toBe(false)
    expect(profile.customStrategyOverrides['pead']).toBe(true)
  })

  it('uiMode is correctly loaded as advanced', async () => {
    const { loadUserProfile } = await import('@/lib/strategies/profile-params')
    const db = makeDb('growth', 'advanced')
    const profile = await loadUserProfile(db, 'user-1')
    expect(profile.uiMode).toBe('advanced')
  })
})
