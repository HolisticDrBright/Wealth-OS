/**
 * PaperTradeRunner — skip counter tests
 *
 * Verifies that the runner correctly classifies outcomes into skip buckets
 * and that the result shape is complete. Uses a minimal mock of the CIO engine
 * and PaperBroker so we can control what each returns without touching the DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Opportunity } from '@/lib/strategies/pipeline-types'

// ── Strategy mock ─────────────────────────────────────────────────────────────
const mockDetectOpportunities = vi.fn<() => Promise<Opportunity[]>>()
vi.mock('@/lib/strategies/all-pipeline-strategies', () => ({
  ALL_STRATEGIES: [
    {
      key: 'carry_trade',
      detectOpportunities: (...args: unknown[]) => mockDetectOpportunities(...args),
    },
  ],
  strategyRegistry: new Map(),
}))

// ── CIO engine mock ───────────────────────────────────────────────────────────
const mockDecide = vi.fn()
vi.mock('@/lib/agents/cio-decision-engine', () => ({
  CIODecisionEngine: class {
    decide = (...args: unknown[]) => mockDecide(...args)
  },
}))

// ── Broker mock ───────────────────────────────────────────────────────────────
const mockFill = vi.fn()
const mockCheckExit = vi.fn().mockResolvedValue(0)
const mockMark = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/paper-trading/PaperBroker', () => ({
  PaperBroker: class {
    fill = (...args: unknown[]) => mockFill(...args)
    checkAndExitPositions = (...args: unknown[]) => mockCheckExit(...args)
    markToMarket = (...args: unknown[]) => mockMark(...args)
  },
}))

// ── ShadowBroker mock ─────────────────────────────────────────────────────────
vi.mock('@/lib/paper-trading/ShadowBroker', () => ({
  ShadowBroker: class {
    track = vi.fn().mockResolvedValue(false)
    markToMarket = vi.fn().mockResolvedValue(undefined)
    checkAndExitShadowPositions = vi.fn().mockResolvedValue(0)
  },
}))

// ── Polymarket validity mock ──────────────────────────────────────────────────
vi.mock('@/lib/paper-trading/polymarket-validity', () => ({
  checkPolymarketValidity: vi.fn().mockResolvedValue({ valid: true, price: 0.6 }),
}))

// ── State gate mock ───────────────────────────────────────────────────────────
vi.mock('@/lib/risk-profile/state-gate', () => ({
  getUserStateOfResidence: vi.fn().mockResolvedValue(null),
  isVenueAllowedInState: vi.fn().mockResolvedValue(true),
}))

// ── Strategy registry mock ────────────────────────────────────────────────────
vi.mock('@/lib/strategies/strategy-registry', () => ({
  STRATEGY_REGISTRY_CONFIG: {
    carry_trade: { maturityStatus: 'paper_trading', assetClass: 'forex' },
  },
}))

function makeOpp(): Opportunity {
  return {
    id: 'opp-1', strategyKey: 'carry_trade', symbol: 'GBP_JPY',
    direction: 'long', assetClass: 'forex', strength: 0.7,
    expectedReturn: 0.02, metadata: {}, detectedAt: new Date().toISOString(),
  }
}

function makeSupabase(): SupabaseClient {
  return {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({ then: vi.fn() }),
    }),
  } as unknown as SupabaseClient
}

describe('PaperTradeRunner skip counters', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('increments alreadyOpen when broker returns already_open', async () => {
    mockDetectOpportunities.mockResolvedValue([makeOpp()])
    mockDecide.mockResolvedValue({ action: 'execute', size: { fraction: 0.05, notionalUsd: 500, rationale: 'x' } })
    mockFill.mockResolvedValue({ status: 'already_open', reason: 'Already holding.' })

    const { runPaperTradingPass } = await import('@/lib/paper-trading/PaperTradeRunner')
    const result = await runPaperTradingPass('user-1', makeSupabase(), ['carry_trade'])

    expect(result.skipped.alreadyOpen).toBe(1)
    expect(result.positionsOpened).toBe(0)
    expect(result.skippedDetails[0].outcome).toBe('already_open')
  })

  it('increments missingPrice when broker returns missing_price', async () => {
    mockDetectOpportunities.mockResolvedValue([makeOpp()])
    mockDecide.mockResolvedValue({ action: 'execute', size: { fraction: 0.05, notionalUsd: 500, rationale: 'x' } })
    mockFill.mockResolvedValue({ status: 'missing_price', reason: 'Price feed null.' })

    const { runPaperTradingPass } = await import('@/lib/paper-trading/PaperTradeRunner')
    const result = await runPaperTradingPass('user-1', makeSupabase(), ['carry_trade'])

    expect(result.skipped.missingPrice).toBe(1)
    expect(result.positionsOpened).toBe(0)
  })

  it('increments riskBlocked when CIO returns block', async () => {
    mockDetectOpportunities.mockResolvedValue([makeOpp()])
    mockDecide.mockResolvedValue({ action: 'block', reason: 'risk veto' })

    const { runPaperTradingPass } = await import('@/lib/paper-trading/PaperTradeRunner')
    const result = await runPaperTradingPass('user-1', makeSupabase(), ['carry_trade'])

    expect(result.skipped.riskBlocked).toBe(1)
    expect(result.decisionsBlock).toBe(1)
  })

  it('increments noSize when decision.size is absent', async () => {
    mockDetectOpportunities.mockResolvedValue([makeOpp()])
    mockDecide.mockResolvedValue({ action: 'execute', size: null })

    const { runPaperTradingPass } = await import('@/lib/paper-trading/PaperTradeRunner')
    const result = await runPaperTradingPass('user-1', makeSupabase(), ['carry_trade'])

    expect(result.skipped.noSize).toBe(1)
    expect(result.positionsOpened).toBe(0)
  })

  it('increments positionsOpened when broker returns opened', async () => {
    mockDetectOpportunities.mockResolvedValue([makeOpp()])
    mockDecide.mockResolvedValue({ action: 'execute', size: { fraction: 0.05, notionalUsd: 500, rationale: 'x' } })
    mockFill.mockResolvedValue({ status: 'opened', id: 'pos-1' })

    const { runPaperTradingPass } = await import('@/lib/paper-trading/PaperTradeRunner')
    const result = await runPaperTradingPass('user-1', makeSupabase(), ['carry_trade'])

    expect(result.positionsOpened).toBe(1)
    expect(result.skippedDetails.length).toBe(0)
  })

  it('result always includes skipped shape with all keys', async () => {
    mockDetectOpportunities.mockResolvedValue([])

    const { runPaperTradingPass } = await import('@/lib/paper-trading/PaperTradeRunner')
    const result = await runPaperTradingPass('user-1', makeSupabase(), ['carry_trade'])

    expect(result).toMatchObject({
      runAt: expect.any(String),
      strategiesRun: 1,
      opportunitiesFound: 0,
      decisionsExecute: 0,
      decisionsBlock: 0,
      positionsOpened: 0,
      positionsClosed: 0,
      skippedDetails: [],
      errors: [],
    })
    const keys: (keyof typeof result.skipped)[] = [
      'alreadyOpen', 'missingPrice', 'expiredMarket', 'resolvedMarket',
      'riskBlocked', 'profileBlocked', 'venueBlocked', 'positionCapBlocked',
      'liquidityBlocked', 'strategyDisabled', 'strategyImmature', 'noSize', 'other',
    ]
    for (const k of keys) expect(result.skipped[k]).toBe(0)
  })
})

describe('PaperTradeRunner Polymarket validity gate', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('counts expiredMarket when validity check returns expired_market', async () => {
    const { checkPolymarketValidity } = await import('@/lib/paper-trading/polymarket-validity')
    vi.mocked(checkPolymarketValidity).mockResolvedValue({
      valid: false, code: 'expired_market', reason: 'Market expired 2026-05-25.',
    })

    mockDetectOpportunities.mockResolvedValue([{
      ...makeOpp(), assetClass: 'polymarket', symbol: 'will-amzn-reach-288-by-may-25-2026',
    }])

    const { runPaperTradingPass } = await import('@/lib/paper-trading/PaperTradeRunner')
    const result = await runPaperTradingPass('user-1', makeSupabase(), ['carry_trade'])

    expect(result.skipped.expiredMarket).toBe(1)
    expect(mockDecide).not.toHaveBeenCalled()
    expect(mockFill).not.toHaveBeenCalled()
  })
})
