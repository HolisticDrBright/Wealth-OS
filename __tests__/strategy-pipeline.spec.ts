/**
 * Strategy pipeline integration tests.
 *
 * Tests:
 *   1. VcpMinervini.runMiroFishConfluence → null (mirofish='skip' regardless of flag)
 *   2. PolymarketWalletCopy.runMiroFishConfluence runs when flag on
 *   3. VcpMinervini.runKronosConfluence blocks (pass=false) when Kronos is bearish + flag on
 *   4. VcpMinervini.runKronosConfluence → null (flag off → getKronosConfluence skips)
 *   5. FxTrendfollowing.execute routes to OANDA, not Alpaca
 *   6. PolymarketResolutionRules.execute routes to PolymarketAdapter
 *   7. logAudit records edge_type, mirofish_used, kronos_used
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VcpMinerviniStrategy } from '@/lib/strategies/impl/stocks/vcp-minervini'
import { PolymarketWalletCopyStrategy } from '@/lib/strategies/impl/polymarket/polymarket-wallet-copy'
import { FxTrendfollowingStrategy } from '@/lib/strategies/impl/forex/stubs'
import { PolymarketResolutionRulesStrategy } from '@/lib/strategies/impl/polymarket/stubs'
import type { Opportunity } from '@/lib/strategies/pipeline-types'
import type { StrategyKey } from '@/lib/strategies/strategy-registry'
import { getKronosConfluence } from '@/lib/predictors/kronos-confluence'
import { OandaAdapter, PolymarketAdapter } from '@/lib/broker-adapters/adapters'

// ─── Mock hoisted data ────────────────────────────────────────────────────────

const { mockReport, mockCanSpend, mockLogUsage } = vi.hoisted(() => {
  const mockReport = {
    jobId: 'job_test',
    reportId: 'report_test',
    bullProbability: 0.65,
    bearProbability: 0.25,
    consensusDirection: 'bullish' as const,
    tailRiskScore: 20,
    confidenceLevel: 'high' as const,
    agentConsensus: 0.78,
    keyFindings: ['Strong momentum confirmed'],
    scenarioSummary: 'Bullish scenario',
  }
  const mockCanSpend = vi.fn().mockResolvedValue({ allowed: true, remainingBudgetCents: 5000 })
  const mockLogUsage = vi.fn().mockResolvedValue(undefined)
  return { mockReport, mockCanSpend, mockLogUsage }
})

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/feature-flags/FeatureFlagService', () => ({
  FeatureFlagService: class {
    canSpend(...args: Parameters<typeof mockCanSpend>) { return mockCanSpend(...args) }
    logUsage(...args: Parameters<typeof mockLogUsage>) { return mockLogUsage(...args) }
  },
}))

vi.mock('@/lib/agents/mirofish-client', () => {
  class MiroFishClient {
    computeSimulationScore(report: typeof mockReport) {
      return report.consensusDirection === 'bullish' ? 72 : 35
    }
    startSimulation() {
      return Promise.resolve({ jobId: 'job_test' })
    }
    pollUntilComplete() {
      return Promise.resolve(mockReport)
    }
  }
  const simulateWithClaude = vi.fn().mockResolvedValue(mockReport)
  return { MiroFishClient, simulateWithClaude }
})

vi.mock('@/lib/predictors/kronos-confluence', () => ({
  getKronosConfluence: vi.fn(),
}))

vi.mock('@/lib/market-data/polymarket-wallets', () => ({
  getTrackedWallets: vi.fn().mockReturnValue(['0xABC']),
  scanTrackedWalletTrades: vi.fn().mockResolvedValue([]),
  getMarketDetails: vi.fn(),
  getWalletPositions: vi.fn().mockResolvedValue([]),
}))

// ─── Shared test fixtures ─────────────────────────────────────────────────────

function makeOpp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'test-opp-1',
    strategyKey: 'vcp_minervini' as StrategyKey,
    symbol: 'AAPL',
    direction: 'long',
    assetClass: 'stocks',
    strength: 0.75,
    expectedReturn: 0.04,
    metadata: {},
    detectedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeSupabase(flagEnabled: boolean, canSpendAllowed: boolean) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'user_settings') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { jurisdiction: 'us' }, error: null }),
        }
      }
      if (table === 'feature_flags') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: flagEnabled
              ? { enabled: true, monthly_budget_usd: 100, alert_threshold_pct: 80 }
              : { enabled: false, monthly_budget_usd: null, alert_threshold_pct: 80 },
            error: null,
          }),
        }
      }
      if (table === 'ai_usage_logs') {
        // For monthly usage query (used by canSpend)
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          then: vi.fn().mockResolvedValue({ data: [{ cost_usd: canSpendAllowed ? 0 : 999 }], error: null }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      if (table === 'kronos_forecasts') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      if (table === 'audit_logs') {
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      }
    }),
  } as never
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('VcpMinervini — MiroFish', () => {
  it('1. runMiroFishConfluence returns null (mirofish=skip) regardless of flag state', async () => {
    mockCanSpend.mockResolvedValue({ allowed: true, remainingBudgetCents: 5000 })
    const strat = new VcpMinerviniStrategy()
    // VCP has mirofish='skip' in registry — should always return null even if flag on
    const verdict = await strat.runMiroFishConfluence(makeOpp(), 'user-1', {} as never)
    expect(verdict).toBeNull()
  })
})

describe('PolymarketWalletCopy — MiroFish', () => {
  it('2. runMiroFishConfluence runs and returns a verdict when flag is on', async () => {
    mockCanSpend.mockResolvedValue({ allowed: true, remainingBudgetCents: 5000 })
    const strat = new PolymarketWalletCopyStrategy()
    const opp = makeOpp({ strategyKey: 'polymarket_wallet_copy', assetClass: 'polymarket' })
    const verdict = await strat.runMiroFishConfluence(opp, 'user-1', {} as never)
    // polymarket_wallet_copy has mirofish='high' → should return a verdict (not null)
    expect(verdict).not.toBeNull()
    expect(verdict?.used).toBe(true)
    expect(['bull', 'bear', 'neutral']).toContain(verdict?.scenario)
  })
})

describe('VcpMinervini — Kronos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset canSpend to allowed=true by default
    mockCanSpend.mockResolvedValue({ allowed: true, remainingBudgetCents: 5000 })
  })

  it('3. runKronosConfluence returns pass=false when Kronos is bearish and flag is on', async () => {
    vi.mocked(getKronosConfluence).mockResolvedValue({
      pass: false,
      skew: 'bearish',
      reason: 'Kronos: bearish skew opposes long',
      forecast: { skew_strength: 0.7 } as never,
    })

    const strat = new VcpMinerviniStrategy()
    const verdict = await strat.runKronosConfluence(makeOpp(), 'user-1', {} as never)

    expect(verdict).not.toBeNull()
    expect(verdict?.pass).toBe(false)
    expect(verdict?.skew).toBe('bearish')
  })

  it('4. runKronosConfluence passes through Kronos "disabled" result when flag is off', async () => {
    // getKronosConfluence handles flag-off internally and returns pass=true + "disabled" reason
    vi.mocked(getKronosConfluence).mockResolvedValue({
      pass: true,
      skew: 'neutral',
      reason: 'kronos disabled by user',
      forecast: undefined,
    })

    const strat = new VcpMinerviniStrategy()
    const verdict = await strat.runKronosConfluence(makeOpp(), 'user-1', {} as never)

    expect(verdict?.pass).toBe(true)
    expect(verdict?.reason).toContain('disabled')
  })
})

describe('Broker routing — execute()', () => {
  const mockBrokerResult = { status: 'submitted' as const, broker_order_id: 'ord_123' }

  function makeSupabaseWithLinkedAccount() {
    return {
      from: vi.fn((table: string) => {
        if (table === 'linked_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }),
    } as never
  }

  it('5. FxTrendfollowingStrategy.execute routes to OANDA (forex default)', async () => {
    const strat = new FxTrendfollowingStrategy()
    const opp = makeOpp({
      strategyKey: 'fx_trendfollowing',
      assetClass: 'forex',
      symbol: 'EUR/USD',
    })
    const size = { fraction: 0.05, notionalUsd: 500, rationale: 'test' }
    const supabase = makeSupabaseWithLinkedAccount()

    const executeSpy = vi.spyOn(OandaAdapter.prototype, 'execute').mockResolvedValue(mockBrokerResult)

    const result = await strat.execute(opp, size, 'user-1', supabase)
    expect(result.broker).toBe('oanda')
    expect(result.status).toBe('submitted')
    executeSpy.mockRestore()
  })

  it('6. PolymarketResolutionRules.execute routes to PolymarketAdapter', async () => {
    const strat = new PolymarketResolutionRulesStrategy()
    const opp = makeOpp({
      strategyKey: 'polymarket_resolution_rules',
      assetClass: 'polymarket',
      symbol: 'POLY:0xabc',
    })
    const size = { fraction: 0.02, notionalUsd: 200, rationale: 'test' }
    const supabase = makeSupabaseWithLinkedAccount()

    const executeSpy = vi.spyOn(PolymarketAdapter.prototype, 'execute').mockResolvedValue(mockBrokerResult)

    const result = await strat.execute(opp, size, 'user-1', supabase)
    expect(result.broker).toBe('polymarket')
    expect(result.status).toBe('submitted')
    executeSpy.mockRestore()
  })
})

describe('logAudit', () => {
  it('7. records edge_type, mirofish_used, kronos_used', async () => {
    const strat = new VcpMinerviniStrategy()
    const opp = makeOpp()

    const insertMock = vi.fn().mockResolvedValue({ error: null })
    const fakeSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'audit_logs') return { insert: insertMock } as never
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() } as never
      }),
    } as never

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const decision = { action: 'execute' as const, size: { fraction: 0.05, notionalUsd: 500, rationale: '' } }
    const verdicts = {
      mirofish: null,
      kronos: { skew: 'bullish' as const, skewStrength: 0.4, pass: true, reason: 'ok', used: true },
      redTeam: { passed: true, score: 70 },
      risk: { veto: false, kellyFraction: 0.06 },
    }

    await strat.logAudit(opp, decision, verdicts, fakeSupabase)

    const insertArgs = insertMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(insertArgs).toBeDefined()
    expect(insertArgs.edge_type).toBe('technical')      // VCP is technical
    expect(insertArgs.mirofish_used).toBe(false)        // null verdict → false
    expect(insertArgs.kronos_used).toBe(true)           // kronos verdict with used=true
    expect(insertArgs.strategy_key).toBe('vcp_minervini')

    consoleSpy.mockRestore()
  })
})
