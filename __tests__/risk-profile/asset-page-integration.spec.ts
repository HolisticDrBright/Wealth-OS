/**
 * Asset-page Risk Profile integration tests
 *
 *  G1  getAssetRiskProfileData('crypto') filters strategyDefs to crypto asset class
 *  G2  getAssetRiskProfileData('all') returns all strategy defs (no asset class filter)
 *  G3  migrationApplied is false when risk_profiles table returns no rows
 *  G4  migrationApplied is true when profiles are present
 *  G5  upsertUserProfile writes the correct profile_key to user_risk_profile
 *  G6  updateUiMode writes the correct ui_mode to user_risk_profile
 *  G7  updateAssetClassOverride merges the new override into existing overrides
 *  G8  updateStrategyOverride merges the new override into existing strategy overrides
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Shared supabase mock builder ───────────────────────────────────────────────

type TableData = Record<string, unknown>[]

function makeSupabase(opts: {
  profiles?: TableData
  strategyDefs?: TableData
  userProfile?: TableData
  existingOverrides?: Record<string, boolean>
  existingAssetOverrides?: Record<string, boolean>
  upsertCapture?: (table: string, data: unknown) => void
}) {
  const {
    profiles = [],
    strategyDefs = [],
    userProfile = [],
    existingOverrides = {},
    existingAssetOverrides = {},
    upsertCapture,
  } = opts

  function makeChain(rows: TableData) {
    return {
      select: (_cols?: string) => ({
        order: (_col?: string) => Promise.resolve({ data: rows, error: null }),
        eq: (_col: string, _val: unknown) => ({
          order: (_c?: string) => Promise.resolve({ data: rows, error: null }),
          single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        }),
        single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      }),
    }
  }

  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }),
    },
    from: (table: string) => {
      if (table === 'risk_profiles') return makeChain(profiles)
      if (table === 'strategy_definitions') {
        return {
          select: (_cols?: string) => ({
            order: (_col?: string) => Promise.resolve({ data: strategyDefs, error: null }),
            eq: (_col: string, assetClass: unknown) => ({
              order: (_c?: string) => Promise.resolve({
                data: strategyDefs.filter(s => s.asset_class === assetClass),
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'user_risk_profile') {
        return {
          select: (cols?: string) => ({
            eq: (_col: string, _val: unknown) => ({
              single: () => {
                if (cols?.includes('custom_strategy_overrides')) {
                  return Promise.resolve({
                    data: { custom_strategy_overrides: existingOverrides },
                    error: null,
                  })
                }
                if (cols?.includes('asset_class_overrides')) {
                  return Promise.resolve({
                    data: { asset_class_overrides: existingAssetOverrides },
                    error: null,
                  })
                }
                return Promise.resolve({ data: userProfile[0] ?? null, error: null })
              },
            }),
            single: () => Promise.resolve({ data: userProfile[0] ?? null, error: null }),
          }),
          upsert: (data: unknown, _opts?: unknown) => {
            upsertCapture?.(table, data)
            return Promise.resolve({ error: null })
          },
        }
      }
      return makeChain([])
    },
  }
}

// ── G1: getAssetRiskProfileData filters by asset class ────────────────────────

describe('G1 getAssetRiskProfileData filters to crypto', () => {
  beforeEach(() => vi.resetModules())

  it('returns only crypto strategy defs when assetClass=crypto', async () => {
    const allDefs = [
      { strategy_key: 'btc_momentum', asset_class: 'crypto', layman_name: 'BTC Momentum', plain_english_description: '', enabled_in_profiles: ['speculative'], requires_advanced_warning: false },
      { strategy_key: 'dividend_aristocrat', asset_class: 'stocks', layman_name: 'Dividend Aristocrat', plain_english_description: '', enabled_in_profiles: ['vault'], requires_advanced_warning: false },
      { strategy_key: 'polymarket_resolution_rules', asset_class: 'polymarket', layman_name: 'PM Rules', plain_english_description: '', enabled_in_profiles: ['speculative'], requires_advanced_warning: false },
    ]
    const sb = makeSupabase({
      profiles: [{ profile_key: 'balanced', display_name: 'Balanced', sort_order: 3 }],
      strategyDefs: allDefs,
    })

    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => sb }))

    const { getAssetRiskProfileData } = await import('@/lib/actions/asset-risk-profile')
    const result = await getAssetRiskProfileData('crypto')

    expect(result.strategyDefs).toHaveLength(1)
    expect(result.strategyDefs[0].strategy_key).toBe('btc_momentum')
  })
})

// ── G2: getAssetRiskProfileData('all') returns everything ─────────────────────

describe('G2 getAssetRiskProfileData all returns all defs', () => {
  beforeEach(() => vi.resetModules())

  it('returns all strategy defs when assetClass=all', async () => {
    const allDefs = [
      { strategy_key: 'btc_momentum', asset_class: 'crypto', layman_name: 'BTC Momentum', plain_english_description: '', enabled_in_profiles: [], requires_advanced_warning: false },
      { strategy_key: 'dividend_aristocrat', asset_class: 'stocks', layman_name: 'Dividend', plain_english_description: '', enabled_in_profiles: [], requires_advanced_warning: false },
    ]
    const sb = makeSupabase({
      profiles: [{ profile_key: 'balanced', sort_order: 3 }],
      strategyDefs: allDefs,
    })

    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => sb }))

    const { getAssetRiskProfileData } = await import('@/lib/actions/asset-risk-profile')
    const result = await getAssetRiskProfileData('all')

    expect(result.strategyDefs).toHaveLength(2)
  })
})

// ── G3: migrationApplied false when profiles table empty ──────────────────────

describe('G3 migrationApplied false when no profiles', () => {
  beforeEach(() => vi.resetModules())

  it('returns migrationApplied=false when risk_profiles is empty', async () => {
    const sb = makeSupabase({ profiles: [], strategyDefs: [] })

    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => sb }))

    const { getAssetRiskProfileData } = await import('@/lib/actions/asset-risk-profile')
    const result = await getAssetRiskProfileData('stocks')

    expect(result.migrationApplied).toBe(false)
  })
})

// ── G4: migrationApplied true when profiles present ──────────────────────────

describe('G4 migrationApplied true when profiles present', () => {
  beforeEach(() => vi.resetModules())

  it('returns migrationApplied=true when risk_profiles has rows', async () => {
    const sb = makeSupabase({
      profiles: [
        { profile_key: 'vault', sort_order: 1 },
        { profile_key: 'balanced', sort_order: 3 },
      ],
      strategyDefs: [],
    })

    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => sb }))

    const { getAssetRiskProfileData } = await import('@/lib/actions/asset-risk-profile')
    const result = await getAssetRiskProfileData('stocks')

    expect(result.migrationApplied).toBe(true)
    expect(result.profiles).toHaveLength(2)
  })
})

// ── G5: upsertUserProfile writes profile_key ─────────────────────────────────

describe('G5 upsertUserProfile writes correct profile_key', () => {
  beforeEach(() => vi.resetModules())

  it('upserts profile_key=growth to user_risk_profile', async () => {
    const captured: Array<{ table: string; data: unknown }> = []
    const sb = makeSupabase({
      upsertCapture: (table, data) => captured.push({ table, data }),
    })

    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => sb }))

    const { upsertUserProfile } = await import('@/lib/actions/risk-profile')
    const result = await upsertUserProfile('growth')

    expect(result.error).toBeUndefined()
    expect(captured).toHaveLength(1)
    expect(captured[0].table).toBe('user_risk_profile')
    const written = captured[0].data as Record<string, unknown>
    expect(written.profile_key).toBe('growth')
    expect(written.user_id).toBe('user-1')
  })
})

// ── G6: updateUiMode writes correct ui_mode ──────────────────────────────────

describe('G6 updateUiMode writes correct ui_mode', () => {
  beforeEach(() => vi.resetModules())

  it('upserts ui_mode=advanced to user_risk_profile', async () => {
    const captured: Array<{ table: string; data: unknown }> = []
    const sb = makeSupabase({
      upsertCapture: (table, data) => captured.push({ table, data }),
    })

    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => sb }))

    const { updateUiMode } = await import('@/lib/actions/risk-profile')
    const result = await updateUiMode('advanced')

    expect(result.error).toBeUndefined()
    const written = captured[0].data as Record<string, unknown>
    expect(written.ui_mode).toBe('advanced')
  })

  it('upserts ui_mode=basic to user_risk_profile', async () => {
    const captured: Array<{ table: string; data: unknown }> = []
    const sb = makeSupabase({
      upsertCapture: (table, data) => captured.push({ table, data }),
    })

    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => sb }))

    const { updateUiMode } = await import('@/lib/actions/risk-profile')
    const result = await updateUiMode('basic')

    expect(result.error).toBeUndefined()
    const written = captured[0].data as Record<string, unknown>
    expect(written.ui_mode).toBe('basic')
  })
})

// ── G7: updateAssetClassOverride merges into existing overrides ───────────────

describe('G7 updateAssetClassOverride merges overrides', () => {
  beforeEach(() => vi.resetModules())

  it('disabling polymarket sets polymarket=false while preserving existing overrides', async () => {
    const captured: Array<{ table: string; data: unknown }> = []
    const sb = makeSupabase({
      existingAssetOverrides: { crypto: true },
      upsertCapture: (table, data) => captured.push({ table, data }),
    })

    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => sb }))

    const { updateAssetClassOverride } = await import('@/lib/actions/risk-profile')
    const result = await updateAssetClassOverride('polymarket', false)

    expect(result.error).toBeUndefined()
    const written = captured[0].data as Record<string, unknown>
    const overrides = written.asset_class_overrides as Record<string, boolean>
    expect(overrides.polymarket).toBe(false)
    expect(overrides.crypto).toBe(true)
  })

  it('re-enabling an asset class sets it back to true', async () => {
    const captured: Array<{ table: string; data: unknown }> = []
    const sb = makeSupabase({
      existingAssetOverrides: { polymarket: false },
      upsertCapture: (table, data) => captured.push({ table, data }),
    })

    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => sb }))

    const { updateAssetClassOverride } = await import('@/lib/actions/risk-profile')
    await updateAssetClassOverride('polymarket', true)

    const written = captured[0].data as Record<string, unknown>
    const overrides = written.asset_class_overrides as Record<string, boolean>
    expect(overrides.polymarket).toBe(true)
  })
})

// ── G8: updateStrategyOverride merges into existing strategy overrides ────────

describe('G8 updateStrategyOverride merges strategy overrides', () => {
  beforeEach(() => vi.resetModules())

  it('disabling vcp_minervini in advanced mode preserves other overrides', async () => {
    const captured: Array<{ table: string; data: unknown }> = []
    const sb = makeSupabase({
      existingOverrides: { quant_momentum: true, pead: false },
      upsertCapture: (table, data) => captured.push({ table, data }),
    })

    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => sb }))

    const { updateStrategyOverride } = await import('@/lib/actions/risk-profile')
    const result = await updateStrategyOverride('vcp_minervini', false)

    expect(result.error).toBeUndefined()
    const written = captured[0].data as Record<string, unknown>
    const overrides = written.custom_strategy_overrides as Record<string, boolean>
    expect(overrides.vcp_minervini).toBe(false)
    expect(overrides.quant_momentum).toBe(true)
    expect(overrides.pead).toBe(false)
  })

  it('enabling memecoin_bondingcurve in advanced mode writes override=true', async () => {
    const captured: Array<{ table: string; data: unknown }> = []
    const sb = makeSupabase({
      existingOverrides: {},
      upsertCapture: (table, data) => captured.push({ table, data }),
    })

    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => sb }))

    const { updateStrategyOverride } = await import('@/lib/actions/risk-profile')
    await updateStrategyOverride('memecoin_bondingcurve', true)

    const written = captured[0].data as Record<string, unknown>
    const overrides = written.custom_strategy_overrides as Record<string, boolean>
    expect(overrides.memecoin_bondingcurve).toBe(true)
  })
})
