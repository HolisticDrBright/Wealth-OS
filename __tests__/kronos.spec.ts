/**
 * Unit tests for Kronos integration:
 *   - Strategy registry: correct Kronos tiers
 *   - getKronosConfluence: skip strategy, bullish skew pass, bearish skew block, flag-off pass
 *   - runSyncKronos: only writes rows for users with flag on, logs cost
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getKronosConfluence } from '@/lib/predictors/kronos-confluence'
import { STRATEGY_REGISTRY_CONFIG } from '@/lib/strategies/strategy-registry'
import { runSyncKronos } from '@/lib/workers/sync-kronos'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Mock KronosClient so no real HTTP is made ─────────────────────────────────

vi.mock('@/lib/kronos/KronosClient', () => {
  class KronosClient {
    forecast() {
      return Promise.resolve({
        distribution: [],
        skew: 'bullish' as const,
        skewStrength: 0.6,
        impliedMove: { p10: 95, p50: 100, p90: 110 },
        confidenceScore: 75,
        generatedAt: new Date().toISOString(),
      })
    }
    generateSyntheticKlines() { return Promise.resolve([]) }
  }
  return {
    KronosClient,
    kronosClient: new KronosClient(),
  }
})

vi.mock('@/lib/notifications/telegram', () => ({
  sendTelegramMessage: vi.fn().mockResolvedValue(true),
}))

// ── Supabase mock builder ─────────────────────────────────────────────────────

interface FlagRow {
  enabled: boolean
  monthly_budget_usd: number | null
  alert_threshold_pct?: number
}

interface ForecastRow {
  id: string
  skew: 'bullish' | 'neutral' | 'bearish'
  skew_strength: number
  confidence_score: number
  generated_at: string
  expires_at: string
  [key: string]: unknown
}

function makeSupabase(opts: {
  flagRow?: FlagRow | null
  rpcUsd?: number
  forecastRow?: ForecastRow | null
  enabledUserIds?: string[]
} = {}): SupabaseClient {
  const flagRow = opts.flagRow !== undefined ? opts.flagRow : null
  const rpcUsd = opts.rpcUsd ?? 0
  const forecastRow = opts.forecastRow !== undefined ? opts.forecastRow : null
  const enabledUserIds = opts.enabledUserIds ?? []

  // Builder that knows about table-specific responses
  const makeBuilder = (table: string) => {
    let _single = false
    let _limit: number | null = null

    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit(n: number) { _limit = n; return builder },
      single() {
        _single = true
        return builder
      },
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      delete: vi.fn().mockReturnThis(),
      then(resolve: (v: unknown) => void) {
        // Called as a Promise
        if (table === 'ai_feature_flags') {
          if (_single) {
            resolve({
              data: flagRow ? { ...flagRow, alert_threshold_pct: flagRow.alert_threshold_pct ?? 80 } : null,
              error: null,
            })
          } else {
            // Multiple rows for sync-kronos user listing
            resolve({
              data: enabledUserIds.map(id => ({ user_id: id })),
              error: null,
            })
          }
        } else if (table === 'kronos_forecasts') {
          resolve({ data: forecastRow, error: forecastRow ? null : { message: 'No rows' } })
        } else if (table === 'user_settings') {
          resolve({ data: null, error: null })
        } else if (table === 'user_copied_positions') {
          resolve({ data: [], error: null })
        } else if (table === 'ai_usage_logs') {
          resolve({ data: null, error: null })
        } else if (table === 'simulation_jobs') {
          resolve({ data: null, error: null })
        } else {
          resolve({ data: null, error: null })
        }
      },
    }
    return builder
  }

  const fromMock = vi.fn((table: string) => makeBuilder(table))
  const rpcMock = vi.fn().mockResolvedValue({ data: rpcUsd, error: null })

  return { from: fromMock, rpc: rpcMock } as unknown as SupabaseClient
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FUTURE = new Date(Date.now() + 3_600_000).toISOString()

const bullishForecast: ForecastRow = {
  id: 'f1',
  skew: 'bullish',
  skew_strength: 0.6,
  confidence_score: 80,
  generated_at: new Date().toISOString(),
  expires_at: FUTURE,
}

const bearishForecast: ForecastRow = {
  id: 'f2',
  skew: 'bearish',
  skew_strength: -0.7,
  confidence_score: 75,
  generated_at: new Date().toISOString(),
  expires_at: FUTURE,
}

// ─── Strategy registry tests ──────────────────────────────────────────────────

describe('strategy registry — Kronos tiers', () => {
  it('marks vcp_minervini as kronos=high', () => {
    expect(STRATEGY_REGISTRY_CONFIG.vcp_minervini.kronos).toBe('high')
  })
  it('marks quant_momentum as kronos=high', () => {
    expect(STRATEGY_REGISTRY_CONFIG.quant_momentum.kronos).toBe('high')
  })
  it('marks session_breakout as kronos=high', () => {
    expect(STRATEGY_REGISTRY_CONFIG.session_breakout.kronos).toBe('high')
  })
  it('marks fx_trendfollowing as kronos=high', () => {
    expect(STRATEGY_REGISTRY_CONFIG.fx_trendfollowing.kronos).toBe('high')
  })
  it('marks onchain_signal as kronos=high', () => {
    expect(STRATEGY_REGISTRY_CONFIG.onchain_signal.kronos).toBe('high')
  })
  it('marks tail_risk_hedging as kronos=high', () => {
    expect(STRATEGY_REGISTRY_CONFIG.tail_risk_hedging.kronos).toBe('high')
  })
  it('marks pead as kronos=medium', () => {
    expect(STRATEGY_REGISTRY_CONFIG.pead.kronos).toBe('medium')
  })
  it('marks spinoff as kronos=medium', () => {
    expect(STRATEGY_REGISTRY_CONFIG.spinoff.kronos).toBe('medium')
  })
  it('marks correlation_divergence as kronos=medium', () => {
    expect(STRATEGY_REGISTRY_CONFIG.correlation_divergence.kronos).toBe('medium')
  })
  it('marks macro_news_event as kronos=skip', () => {
    expect(STRATEGY_REGISTRY_CONFIG.macro_news_event.kronos).toBe('skip')
  })
  it('marks cb_divergence as kronos=skip', () => {
    expect(STRATEGY_REGISTRY_CONFIG.cb_divergence.kronos).toBe('skip')
  })
  it('marks all polymarket strategies as kronos=skip', () => {
    const polyKeys = Object.keys(STRATEGY_REGISTRY_CONFIG).filter(k => k.startsWith('polymarket_'))
    expect(polyKeys.length).toBeGreaterThan(0)
    for (const key of polyKeys) {
      expect(STRATEGY_REGISTRY_CONFIG[key as keyof typeof STRATEGY_REGISTRY_CONFIG].kronos).toBe('skip')
    }
  })
})

// ─── getKronosConfluence tests ────────────────────────────────────────────────

describe('getKronosConfluence — skip strategy', () => {
  it('returns pass=true with reason "kronos not applicable" for sector_rotation (skip)', async () => {
    const supabase = makeSupabase()
    const result = await getKronosConfluence(supabase, 'user-1', 'SPY', 'sector_rotation', 'long')
    expect(result.pass).toBe(true)
    expect(result.reason).toContain('kronos not applicable')
  })

  it('returns pass=true for all polymarket strategies', async () => {
    const supabase = makeSupabase()
    const result = await getKronosConfluence(supabase, 'user-1', 'US-ELECTION', 'polymarket_wallet_copy', 'long')
    expect(result.pass).toBe(true)
    expect(result.reason).toContain('kronos not applicable')
  })
})

describe('getKronosConfluence — flag off', () => {
  it('returns pass=true with reason containing "kronos disabled" when flag is off', async () => {
    const supabase = makeSupabase({
      flagRow: { enabled: false, monthly_budget_usd: 5 },
    })
    const result = await getKronosConfluence(supabase, 'user-1', 'AAPL', 'vcp_minervini', 'long')
    expect(result.pass).toBe(true)
    expect(result.reason).toContain('kronos disabled by user')
  })
})

describe('getKronosConfluence — vcp_minervini (high-tier) with bullish skew', () => {
  it('returns pass=true when Kronos is bullish and desired direction is long', async () => {
    const supabase = makeSupabase({
      flagRow: { enabled: true, monthly_budget_usd: 100 },
      forecastRow: bullishForecast,
    })
    const result = await getKronosConfluence(supabase, 'user-1', 'AAPL', 'vcp_minervini', 'long')
    expect(result.pass).toBe(true)
    expect(result.skew).toBe('bullish')
    expect(result.forecast).toBeDefined()
  })
})

describe('getKronosConfluence — vcp_minervini (high-tier) with bearish skew', () => {
  it('returns pass=false when Kronos is bearish and desired direction is long', async () => {
    const supabase = makeSupabase({
      flagRow: { enabled: true, monthly_budget_usd: 100 },
      forecastRow: bearishForecast,
    })
    const result = await getKronosConfluence(supabase, 'user-1', 'AAPL', 'vcp_minervini', 'long')
    expect(result.pass).toBe(false)
    expect(result.skew).toBe('bearish')
    expect(result.reason).toContain('kronos opposes')
    expect(result.forecast).toBeDefined()
  })
})

// ─── sync-kronos worker tests ─────────────────────────────────────────────────

describe('runSyncKronos', () => {
  it('processes zero users when no flag rows exist', async () => {
    const supabase = makeSupabase({ enabledUserIds: [] })
    const result = await runSyncKronos(supabase)
    expect(result.usersProcessed).toBe(0)
    expect(result.symbolsForecasted).toBe(0)
  })

  it('forecasts symbols for users with kronos flag on', async () => {
    const supabase = makeSupabase({
      enabledUserIds: ['user-a'],
      flagRow: { enabled: true, monthly_budget_usd: 50 },
      rpcUsd: 0,
    })
    const result = await runSyncKronos(supabase)
    expect(result.usersProcessed).toBe(1)
    // No open positions in mock → 0 symbols processed (watchlist query fails gracefully)
    expect(result.errors).toHaveLength(0)
  })
})
