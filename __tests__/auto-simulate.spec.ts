/**
 * Unit tests for runAutoSimulate and the strategy registry.
 *
 * All external dependencies are mocked:
 *   - FeatureFlagService (via supabase mock)
 *   - MiroFishClient / simulateWithClaude
 *   - Supabase query builder
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runAutoSimulate } from '@/lib/workers/auto-simulate'
import { STRATEGY_REGISTRY_CONFIG } from '@/lib/strategies/strategy-registry'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SimulationReport } from '@/lib/agents/types'

// ── Hoist mockReport so it's available inside the vi.mock factory ─────────────

const { mockReport } = vi.hoisted(() => {
  const mockReport = {
    jobId: 'job_test',
    reportId: 'report_test',
    bullProbability: 0.7,
    bearProbability: 0.3,
    consensusDirection: 'bullish' as const,
    tailRiskScore: 20,
    confidenceLevel: 'high' as const,
    agentConsensus: 0.8,
    keyFindings: ['Strong momentum'],
    scenarioSummary: 'Bullish short-term outlook',
  }
  return { mockReport }
})

vi.mock('@/lib/agents/mirofish-client', () => {
  class MiroFishClient {
    startSimulation() { return Promise.resolve({ jobId: 'job_test' }) }
    pollUntilComplete() { return Promise.resolve(mockReport) }
    computeSimulationScore() { return 78 }
  }
  return {
    MiroFishClient,
    simulateWithClaude: vi.fn().mockResolvedValue(mockReport),
  }
})

vi.mock('@/lib/notifications/telegram', () => ({
  sendTelegramMessage: vi.fn().mockResolvedValue(true),
}))

// ── Supabase mock helpers ─────────────────────────────────────────────────────

interface FlagRow {
  enabled: boolean
  monthly_budget_usd: number | null
  alert_threshold_pct?: number
}

function makeSupabase(opts: {
  flagRow?: FlagRow | null
  rpcUsd?: number
} = {}): SupabaseClient {
  const flagRow = opts.flagRow !== undefined ? opts.flagRow : null
  const rpcUsd = opts.rpcUsd ?? 0

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

  const settingsBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  }

  const logBuilder = {
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  }

  const jobBuilder = {
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  }

  const fromMock = vi.fn((table: string) => {
    if (table === 'ai_feature_flags') return flagBuilder
    if (table === 'user_settings') return settingsBuilder
    if (table === 'ai_usage_logs') return logBuilder
    if (table === 'simulation_jobs') return jobBuilder
    return flagBuilder
  })

  const rpcMock = vi.fn().mockResolvedValue({ data: rpcUsd, error: null })

  return { from: fromMock, rpc: rpcMock } as unknown as SupabaseClient
}

// ── Base job ──────────────────────────────────────────────────────────────────

const BASE_JOB = {
  tradeId: 'trade-123',
  userId: 'user-abc',
  seedContent: 'Test seed',
  predictionQuery: 'Will this trade profit?',
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('strategy registry', () => {
  it('marks vcp_minervini as mirofish=skip', () => {
    expect(STRATEGY_REGISTRY_CONFIG.vcp_minervini.mirofish).toBe('skip')
  })

  it('marks polymarket_wallet_copy as mirofish=high', () => {
    expect(STRATEGY_REGISTRY_CONFIG.polymarket_wallet_copy.mirofish).toBe('high')
  })

  it('marks sector_rotation as mirofish=medium', () => {
    expect(STRATEGY_REGISTRY_CONFIG.sector_rotation.mirofish).toBe('medium')
  })
})

describe('runAutoSimulate — strategy skip', () => {
  it('skips immediately for vcp_minervini regardless of flag state', async () => {
    const supabase = makeSupabase({
      flagRow: { enabled: true, monthly_budget_usd: 100 },
    })

    const result = await runAutoSimulate(supabase, {
      ...BASE_JOB,
      strategyKey: 'vcp_minervini',
    })

    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('strategy_not_eligible')
    expect(result.costCents).toBe(0)
    // Feature flag should never be consulted
    expect((supabase.from as ReturnType<typeof vi.fn>).mock.calls
      .some((c: unknown[]) => c[0] === 'ai_feature_flags')).toBe(false)
  })
})

describe('runAutoSimulate — flag off', () => {
  it('skips when mirofish flag is disabled', async () => {
    const supabase = makeSupabase({
      flagRow: { enabled: false, monthly_budget_usd: 50 },
    })

    const result = await runAutoSimulate(supabase, {
      ...BASE_JOB,
      strategyKey: 'polymarket_wallet_copy',
    })

    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('disabled')
    expect(result.costCents).toBe(0)
  })
})

describe('runAutoSimulate — over budget', () => {
  it('skips when monthly spend has exceeded budget', async () => {
    const supabase = makeSupabase({
      flagRow: { enabled: true, monthly_budget_usd: 1.0 }, // $1 budget
      rpcUsd: 1.0,                                          // $1 already spent → 0 remaining
    })

    const result = await runAutoSimulate(supabase, {
      ...BASE_JOB,
      strategyKey: 'polymarket_wallet_copy', // high tier = $2 estimate > $0 remaining
    })

    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('over_budget')
    expect(result.costCents).toBe(0)
  })
})

describe('runAutoSimulate — success path', () => {
  it('runs and returns a report for polymarket_wallet_copy when flag is on and under budget', async () => {
    const supabase = makeSupabase({
      flagRow: { enabled: true, monthly_budget_usd: 100 }, // $100 budget, $0 spent
      rpcUsd: 0,
    })

    const result = await runAutoSimulate(supabase, {
      ...BASE_JOB,
      strategyKey: 'polymarket_wallet_copy',
    })

    expect(result.skipped).toBe(false)
    expect(result.report).toBeDefined()
    expect(result.score).toBeGreaterThan(0)
    expect(result.costCents).toBeGreaterThan(0)
  })
})

describe('runAutoSimulate — medium regime gate', () => {
  it('skips sector_rotation when isFomcDay is false', async () => {
    const supabase = makeSupabase({
      flagRow: { enabled: true, monthly_budget_usd: 100 },
      rpcUsd: 0,
    })

    const result = await runAutoSimulate(supabase, {
      ...BASE_JOB,
      strategyKey: 'sector_rotation',
      regime: { isFomcDay: false },
    })

    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('regime_not_active')
  })

  it('runs sector_rotation when isFomcDay is true and flag is on', async () => {
    const supabase = makeSupabase({
      flagRow: { enabled: true, monthly_budget_usd: 100 },
      rpcUsd: 0,
    })

    const result = await runAutoSimulate(supabase, {
      ...BASE_JOB,
      strategyKey: 'sector_rotation',
      regime: { isFomcDay: true },
    })

    expect(result.skipped).toBe(false)
    expect(result.report).toBeDefined()
  })
})
