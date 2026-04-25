/**
 * Unit tests for FeatureFlagService and withFeatureFlag.
 *
 * Supabase's fluent builder is mocked at the module level. Each test
 * configures what _getFlag() and get_monthly_spend() should return.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FeatureFlagService } from '@/lib/feature-flags/FeatureFlagService'
import { withFeatureFlag } from '@/lib/feature-flags/withFeatureFlag'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Telegram helper: suppress real HTTP calls ─────────────────────────────────
vi.mock('@/lib/notifications/telegram', () => ({
  sendTelegramMessage: vi.fn().mockResolvedValue(true),
}))

// ── Supabase mock factory ─────────────────────────────────────────────────────

interface MockOptions {
  /** Flag row returned by ai_feature_flags query. null = no row found. */
  flagRow?: {
    enabled: boolean
    monthly_budget_usd: number | null
    alert_threshold_pct?: number
  } | null
  /** USD value returned by get_monthly_spend RPC. Default 0. */
  rpcUsd?: number
  /** If provided, insert will return this error message. */
  insertError?: string
}

function makeSupabase(opts: MockOptions = {}): SupabaseClient {
  const flagRow = opts.flagRow !== undefined ? opts.flagRow : null
  const rpcUsd = opts.rpcUsd ?? 0

  // Builder returned for ai_feature_flags queries
  const flagBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: flagRow
        ? { ...flagRow, alert_threshold_pct: flagRow.alert_threshold_pct ?? 80 }
        : null,
      error: null,
    }),
  }

  // Builder returned for user_settings queries
  const settingsBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  }

  // Builder returned for ai_usage_logs inserts
  const logBuilder = {
    insert: vi.fn().mockResolvedValue({
      data: null,
      error: opts.insertError ? { message: opts.insertError } : null,
    }),
  }

  const fromMock = vi.fn((table: string) => {
    if (table === 'ai_feature_flags') return flagBuilder
    if (table === 'user_settings') return settingsBuilder
    if (table === 'ai_usage_logs') return logBuilder
    return flagBuilder
  })

  const rpcMock = vi.fn().mockResolvedValue({ data: rpcUsd, error: null })

  return { from: fromMock, rpc: rpcMock } as unknown as SupabaseClient
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const USER_ID = 'user-abc'
const FEATURE = 'mirofish'

describe('FeatureFlagService.canSpend', () => {
  it('returns allowed=true when flag is enabled and under budget', async () => {
    const supabase = makeSupabase({
      flagRow: { enabled: true, monthly_budget_usd: 5.0 },
      rpcUsd: 1.0, // $1 spent of $5 budget
    })
    const svc = new FeatureFlagService(supabase)

    const result = await svc.canSpend(USER_ID, FEATURE, 100) // 100 cents = $1 proposed

    expect(result.allowed).toBe(true)
    if (result.allowed) {
      // $5 budget - $1 spent - $1 proposed = $3 remaining = 300 cents
      expect(result.remainingBudgetCents).toBe(300)
    }
  })

  it('returns allowed=false with reason=disabled when flag is off', async () => {
    const supabase = makeSupabase({
      flagRow: { enabled: false, monthly_budget_usd: 5.0 },
      rpcUsd: 0,
    })
    const svc = new FeatureFlagService(supabase)

    const result = await svc.canSpend(USER_ID, FEATURE, 100)

    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.reason).toBe('disabled')
    }
  })

  it('returns allowed=false with reason=over_budget when spend exceeds budget', async () => {
    const supabase = makeSupabase({
      flagRow: { enabled: true, monthly_budget_usd: 2.0 },
      rpcUsd: 1.90, // $1.90 spent of $2 budget; 100 cents proposed = $1 → over
    })
    const svc = new FeatureFlagService(supabase)

    const result = await svc.canSpend(USER_ID, FEATURE, 100) // $1 > $0.10 remaining

    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.reason).toBe('over_budget')
      expect(result.remainingBudgetCents).toBe(10) // $2 - $1.90 = $0.10 = 10 cents
    }
  })
})

describe('FeatureFlagService.logUsage', () => {
  it('calls supabase insert with cents converted to usd', async () => {
    const supabase = makeSupabase()
    const svc = new FeatureFlagService(supabase)

    await svc.logUsage({
      userId: USER_ID,
      featureKey: FEATURE,
      operation: 'simulate_trade',
      costCents: 150,
      tokensIn: 800,
      tokensOut: 200,
    })

    const logBuilder = (supabase.from as ReturnType<typeof vi.fn>)('ai_usage_logs')
    expect(logBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: USER_ID,
        feature_key: FEATURE,
        cost_usd: 1.5,
        operation: 'simulate_trade',
        tokens_in: 800,
        tokens_out: 200,
      })
    )
  })
})

describe('withFeatureFlag', () => {
  it('returns result=null and skipped=true when feature is gated (disabled)', async () => {
    const supabase = makeSupabase({
      flagRow: { enabled: false, monthly_budget_usd: 5.0 },
    })

    const fn = vi.fn()
    const { result, skipped, reason } = await withFeatureFlag(
      supabase,
      USER_ID,
      FEATURE,
      100,
      'simulate_trade',
      fn
    )

    expect(result).toBeNull()
    expect(skipped).toBe(true)
    expect(reason).toBe('disabled')
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns result and skipped=false when feature is enabled and under budget', async () => {
    const supabase = makeSupabase({
      flagRow: { enabled: true, monthly_budget_usd: 10.0 },
      rpcUsd: 0,
    })

    const { result, skipped, costCents } = await withFeatureFlag(
      supabase,
      USER_ID,
      FEATURE,
      100,
      'simulate_trade',
      async () => ({ result: { score: 42 }, actualCostCents: 90 })
    )

    expect(skipped).toBe(false)
    expect(result).toEqual({ score: 42 })
    expect(costCents).toBe(90)
  })
})
