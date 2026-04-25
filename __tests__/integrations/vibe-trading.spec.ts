/**
 * Vibe-Trading integration tests.
 *
 * Tests the VibeTradingClient's gating, timeout, and graceful-degradation
 * behaviour without requiring a live MCP server.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { VibeTradingClient } from '@/lib/integrations/vibe-trading/VibeTradingClient'
import { VIBE_TRADING_TOOLS } from '@/lib/integrations/vibe-trading/mcp-config'

// ─── Mock FeatureFlagService ───────────────────────────────────────────────────

const { mockCanSpend, mockLogUsage } = vi.hoisted(() => {
  const mockCanSpend = vi.fn().mockResolvedValue({ allowed: true })
  const mockLogUsage = vi.fn().mockResolvedValue(undefined)
  return { mockCanSpend, mockLogUsage }
})

vi.mock('@/lib/feature-flags/FeatureFlagService', () => ({
  FeatureFlagService: class {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    canSpend(...args: any[]) { return mockCanSpend(...args) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logUsage(...args: any[]) { return mockLogUsage(...args) }
  },
}))

function makeSupabase(): SupabaseClient {
  return {} as SupabaseClient
}

describe('VibeTradingClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    mockCanSpend.mockResolvedValue({ allowed: true })
  })

  // ── Test 1: Tool manifest is complete ───────────────────────────────────────
  it('exports exactly 17 tools in the manifest', () => {
    expect(VIBE_TRADING_TOOLS).toHaveLength(17)
    const names = VIBE_TRADING_TOOLS.map(t => t.name)
    expect(names).toContain('backtest')
    expect(names).toContain('factor_analysis')
    expect(names).toContain('pattern_recognition')
    expect(names).toContain('analyze_options')
  })

  // ── Test 2: Graceful degradation when server is unreachable ─────────────────
  it('returns skipped=true with reason when MCP server is unreachable', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const client = new VibeTradingClient(makeSupabase(), 'user-123')
    const res = await client.factorAnalysis({ symbols: ['AAPL', 'MSFT'] })

    expect(res.skipped).toBe(true)
    expect(res.result).toBeNull()
    expect(res.reason).toContain('unreachable')
  })

  // ── Test 3: Returns result when server responds OK ───────────────────────────
  it('returns result when MCP server responds with 200', async () => {
    const mockData = [
      { symbol: 'AAPL', factor_scores: { momentum: 0.8, value: 0.4 }, composite_score: 0.7, rank: 1, recommendation: 'overweight' },
    ]
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    } as Response)

    const client = new VibeTradingClient(makeSupabase(), 'user-123')
    const res = await client.factorAnalysis({ symbols: ['AAPL'] })

    expect(res.skipped).toBe(false)
    expect(res.result).toEqual(mockData)
  })

  // ── Test 4: Returns skipped when feature flag gate blocks ────────────────────
  it('returns skipped=true when FeatureFlagService.canSpend disallows', async () => {
    mockCanSpend.mockResolvedValueOnce({ allowed: false, reason: 'disabled' })

    const client = new VibeTradingClient(makeSupabase(), 'user-abc')
    const res = await client.backtest({
      strategy_code: 'def strategy(bars): return []',
      symbol: 'SPY',
      start_date: '2024-01-01',
      end_date: '2025-01-01',
    })

    expect(res.skipped).toBe(true)
    expect(res.reason).toContain('disabled')
    expect(fetch).not.toHaveBeenCalled()
  })

  // ── Test 5: HTTP 500 from server returns skipped ─────────────────────────────
  it('returns skipped when MCP server returns non-200 status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal server error' }),
    } as Response)

    const client = new VibeTradingClient(makeSupabase(), 'user-xyz')
    const res = await client.patternRecognition({ symbol: 'TSLA' })

    expect(res.skipped).toBe(true)
    expect(res.reason).toContain('HTTP 500')
  })
})
