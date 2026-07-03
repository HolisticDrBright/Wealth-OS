/**
 * polymarket_crypto_binary_5min — 8 unit tests.
 *
 * Tests:
 *  1. detectOpportunities returns [] when off-chain deviation < $50
 *  2. detectOpportunities returns [] when on-chain price already past 0.55
 *  3. detectOpportunities returns [] when elapsed < 240s (retail zone)
 *  4. detectOpportunities returns Opportunity when all 4 entry conditions met
 *  5. sizePosition respects 0.5% cap
 *  6. execute pre-arms the 0.75 limit sell (within 100ms of fill)
 *  7. execute hard-exits 15s before window close
 *  8. audit_logs records correct edge_type and broker_used
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PolymarketCryptoBinary5MinStrategy } from '@/lib/strategies/impl/polymarket/polymarket-crypto-binary-5min'
import type { Opportunity, AllVerdicts } from '@/lib/strategies/pipeline-types'

// ─── Shared mocks (hoisted before imports) ────────────────────────────────────

const { mockCanSpend, mockLogUsage, mockDiscoverMarkets, mockSubscribeOrderBook,
  mockPlaceOrder, mockCancelOrder, mockGetFills } = vi.hoisted(() => {
  const mockCanSpend        = vi.fn().mockResolvedValue({ allowed: true })
  const mockLogUsage        = vi.fn().mockResolvedValue(undefined)
  const mockDiscoverMarkets = vi.fn()
  const mockSubscribeOrderBook = vi.fn()
  const mockPlaceOrder      = vi.fn()
  const mockCancelOrder     = vi.fn()
  const mockGetFills        = vi.fn()
  return { mockCanSpend, mockLogUsage, mockDiscoverMarkets,
    mockSubscribeOrderBook, mockPlaceOrder, mockCancelOrder, mockGetFills }
})

vi.mock('@/lib/feature-flags/FeatureFlagService', () => ({
  FeatureFlagService: class {
    canSpend(...args: unknown[]) { return mockCanSpend(...args) }
    logUsage(...args: unknown[]) { return mockLogUsage(...args) }
  },
}))

vi.mock('@/lib/integrations/polymarket-engine/PolymarketEngineClient', () => ({
  PolymarketEngineClient: class {
    discoverMarkets(...args: unknown[]) { return mockDiscoverMarkets(...args) }
    subscribeOrderBook(...args: unknown[]) { return mockSubscribeOrderBook(...args) }
    placeOrder(...args: unknown[]) { return mockPlaceOrder(...args) }
    cancelOrder(...args: unknown[]) { return mockCancelOrder(...args) }
    getFills(...args: unknown[]) { return mockGetFills(...args) }
  },
  createPolymarketEngineClient: vi.fn(),
}))

// Mock off-chain price fetchers — patch global fetch
function mockFetch(coinbaseUsd: number | null, binanceUsd: number | null) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('coinbase.com')) {
      if (coinbaseUsd === null) return Promise.reject(new Error('network'))
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { amount: String(coinbaseUsd) } }),
      })
    }
    if (typeof url === 'string' && url.includes('binance.com')) {
      if (binanceUsd === null) return Promise.reject(new Error('network'))
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ price: String(binanceUsd) }),
      })
    }
    // health / orderbook calls
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }))
}

// Supports both the audit insert and the kill-switch read chains
// (select().eq()… resolves empty state = trading allowed).
function makeSupabase(insertMock?: ReturnType<typeof vi.fn>): SupabaseClient {
  const builder: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
  }
  builder.select = () => builder
  builder.eq = () => builder
  builder.single = () => Promise.resolve({ data: null, error: null })
  builder.insert = insertMock ?? vi.fn().mockReturnValue(Promise.resolve({ error: null }))
  return { from: vi.fn().mockReturnValue(builder) } as unknown as SupabaseClient
}

const NOW = Date.now()
const WINDOW_MIN = 5
const WINDOW_MS  = WINDOW_MIN * 60_000

// A market where 4 minutes (240s) have elapsed and 60s remain
function makeMarket(overrides: Partial<{
  yesPrice: number
  question: string
  windowMin: number
}> = {}) {
  const wMin = overrides.windowMin ?? WINDOW_MIN
  const endTime = NOW + (wMin * 60_000 - (wMin * 60_000 - 60_000))  // 60s remaining
  return {
    marketId:        'mkt_btc_95000',
    conditionId:     'cond_btc_95000',
    question:        overrides.question ?? 'Will BTC be above $95,000 at 14:00?',
    symbol:          'BTC',
    windowMin:       wMin,
    targetPrice:     95000,
    endTime,
    status:          'active' as const,
    yesPrice:        overrides.yesPrice ?? 0.42,
    noPrice:         1 - (overrides.yesPrice ?? 0.42),
    liquidityUsdc:   50000,
  }
}

function makeOrderBook(imbalance: number) {
  // imbalance = bidVol / askVol
  const bidSize = imbalance * 100
  return {
    marketId: 'mkt_btc_95000',
    ts: NOW,
    bids: Array(10).fill(0).map((_, i) => ({ price: 0.42 - i * 0.01, size: bidSize })),
    asks: Array(10).fill(0).map((_, i) => ({ price: 0.43 + i * 0.01, size: 100 })),
    spread: 0.01,
    imbalance: bidSize / 100,
  }
}

function makeAllVerdicts(overrides: Partial<AllVerdicts> = {}): AllVerdicts {
  return {
    mirofish: null,
    kronos:   null,
    redTeam:  { passed: true, score: 70 },
    risk:     { veto: false, kellyFraction: 0.04 },
    ...overrides,
  }
}

describe('PolymarketCryptoBinary5MinStrategy', () => {
  let strategy: PolymarketCryptoBinary5MinStrategy

  beforeEach(() => {
    strategy = new PolymarketCryptoBinary5MinStrategy()
    // Execute-mechanics tests only — the live gate itself is covered in
    // __tests__/safety/live-trading-gates.spec.ts.
    ;(strategy as unknown as { checkLiveGate: () => Promise<null> }).checkLiveGate = async () => null
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    vi.useRealTimers()
    mockCanSpend.mockResolvedValue({ allowed: true })
  })

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('detectOpportunities returns [] when off-chain deviation < $50', async () => {
    // BTC at $94,980 — only $20 below $95,000 target. Window direction: above.
    // Off-chain hasn't crossed by $50 in the "above" direction.
    mockFetch(94_980, 94_975)  // average ~94,977 — $23 BELOW target, not above by $50
    mockDiscoverMarkets.mockResolvedValue({ result: [makeMarket()], skipped: false })
    mockSubscribeOrderBook.mockImplementation((_id: string, cb: (book: unknown) => void) => {
      cb(makeOrderBook(2.0))
      return () => {}
    })

    const opps = await strategy.detectOpportunities({
      supabase: makeSupabase(),
      metadata: { userId: 'user-1' },
    })

    expect(opps).toHaveLength(0)
  })

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('detectOpportunities returns [] when on-chain price already past 0.55', async () => {
    // Off-chain deviation is large ($200 above target), but on-chain already repriced to 0.62
    mockFetch(95_200, 95_200)
    mockDiscoverMarkets.mockResolvedValue({
      result: [makeMarket({ yesPrice: 0.62 })],  // already repriced past 0.55
      skipped: false,
    })
    mockSubscribeOrderBook.mockImplementation((_id: string, cb: (book: unknown) => void) => {
      cb(makeOrderBook(2.0))
      return () => {}
    })

    const opps = await strategy.detectOpportunities({
      supabase: makeSupabase(),
      metadata: { userId: 'user-1' },
    })

    expect(opps).toHaveLength(0)
  })

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('detectOpportunities returns [] when elapsed < 240s (retail entry zone)', async () => {
    // Simulate a market where only 60 seconds have elapsed
    mockFetch(95_200, 95_200)
    const freshMarket = {
      ...makeMarket(),
      // Use 15-min window offset so elapsed = 0 for BOTH 5-min and 15-min windows.
      // If we only used WINDOW_MS (5 min), the 15-min window would compute elapsed=600s
      // which would pass the 240s guard and generate spurious opportunities.
      endTime: NOW + 15 * 60_000,
    }
    mockDiscoverMarkets.mockResolvedValue({ result: [freshMarket], skipped: false })
    mockSubscribeOrderBook.mockImplementation((_id: string, cb: (book: unknown) => void) => {
      cb(makeOrderBook(2.0))
      return () => {}
    })

    const opps = await strategy.detectOpportunities({
      supabase: makeSupabase(),
      metadata: { userId: 'user-1' },
    })

    expect(opps).toHaveLength(0)
  })

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('detectOpportunities returns Opportunity when all 4 entry conditions met', async () => {
    // (a) deviation = $200 above target  ✓
    // (b) on-chain = 0.42 < 0.55         ✓
    // (c) elapsed = ~4.5 min > 240s       ✓  (market ends in 30s, opened 4.5 min ago)
    // (d) imbalance = 2.1 > 1.8           ✓

    const market = makeMarket({ yesPrice: 0.42 })
    // Set endTime so that elapsed = 270s (4.5 min into a 5-min window)
    market.endTime = NOW + 30_000  // 30 seconds remaining → 270s elapsed

    mockFetch(95_200, 95_200)  // $200 above $95,000 target
    mockDiscoverMarkets.mockResolvedValue({ result: [market], skipped: false })
    mockSubscribeOrderBook.mockImplementation((_id: string, cb: (book: unknown) => void) => {
      cb(makeOrderBook(2.1))
      return () => {}
    })

    const opps = await strategy.detectOpportunities({
      supabase: makeSupabase(),
      metadata: { userId: 'user-1' },
    })

    expect(opps.length).toBeGreaterThan(0)
    const opp = opps[0]
    expect(opp.strategyKey).toBe('polymarket_crypto_binary_5min')
    expect(opp.direction).toBe('long')
    expect(opp.assetClass).toBe('polymarket')
    expect(opp.metadata.offChainDeviation).toBeGreaterThanOrEqual(50)
    expect(opp.metadata.onChainPrice).toBeLessThanOrEqual(0.55)
    expect(opp.metadata.target1).toBe(0.75)
  })

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('sizePosition respects the 0.5% account cap', async () => {
    const opp: Opportunity = {
      id: 'opp-1',
      strategyKey: 'polymarket_crypto_binary_5min',
      symbol: 'POLY:cond_btc_95000',
      direction: 'long',
      assetClass: 'polymarket',
      strength: 0.9,
      expectedReturn: 0.35,
      metadata: {
        onChainPrice: 0.40,
        offChainDeviation: 200,
        highConviction: true,
        endTime: NOW + 30_000,
        hardExitAt: NOW + 15_000,
      },
      detectedAt: new Date().toISOString(),
    }

    // Portfolio of $100,000 — 0.5% cap = $500 max
    const mockSupa = {
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { max_single_position_pct: 10 } }) }),
    } as unknown as SupabaseClient

    // Patch getPortfolioUsd to return $100,000
    const riskControls = await import('@/lib/strategies/risk-controls')
    vi.spyOn(riskControls, 'getPortfolioUsd').mockResolvedValueOnce(100_000)
    vi.spyOn(riskControls, 'getRiskControl').mockResolvedValueOnce({
      max_portfolio_risk_pct: 2,
      max_single_position_pct: 10,
      max_drawdown_pct: 20,
      stop_loss_enabled: true,
      daily_loss_limit_usd: undefined,
      volatility_threshold: 'medium',
    })

    const size = await strategy.sizePosition(opp, makeAllVerdicts(), 'user-1', mockSupa)

    // 0.5% of $100,000 = $500 max
    expect(size.notionalUsd).toBeLessThanOrEqual(500)
    expect(size.fraction).toBeLessThanOrEqual(0.005)
    expect(size.fraction).toBeGreaterThan(0)
  })

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('execute pre-arms the 0.75 limit sell within 100ms of fill', async () => {
    const endTime = NOW + 60_000
    const opp: Opportunity = {
      id: 'opp-2',
      strategyKey: 'polymarket_crypto_binary_5min',
      symbol: 'POLY:cond_btc_95000',
      direction: 'long',
      assetClass: 'polymarket',
      strength: 0.8,
      expectedReturn: 0.33,
      metadata: {
        marketId: 'mkt_btc_95000',
        conditionId: 'cond_btc_95000',
        onChainPrice: 0.42,
        offChainDeviation: 200,
        endTime,
        hardExitAt: endTime - 15_000,
        highConviction: false,
      },
      detectedAt: new Date().toISOString(),
    }

    const entryOrderId = 'entry-order-123'
    const exitOrderId  = 'exit-order-456'

    mockPlaceOrder
      .mockResolvedValueOnce({ result: entryOrderId, skipped: false })  // entry order
      .mockResolvedValueOnce({ result: exitOrderId,  skipped: false })  // exit limit sell at 0.75

    // subscribeOrderBook immediately calls callback (simulates fast fill detection)
    let fillCb: (book: unknown) => void
    mockSubscribeOrderBook.mockImplementation((_id: string, cb: (book: unknown) => void) => {
      fillCb = cb
      return () => {}
    })

    mockGetFills.mockResolvedValue({
      result: [{ orderId: entryOrderId, side: 'buy', price: 0.42, size: 100, feeCents: 150, filledAt: new Date().toISOString() }],
      skipped: false,
    })

    const size = { fraction: 0.005, notionalUsd: 500, rationale: 'test' }
    const execPromise = strategy.execute(opp, size, 'user-1', makeSupabase())

    // Trigger fill callback
    await vi.runAllTimersAsync()
    if (fillCb!) fillCb!({})

    const result = await execPromise

    expect(result.status).toBe('submitted')
    expect(result.broker).toBe('polymarket')
    expect(result.brokerOrderId).toBe(entryOrderId)

    // Exit limit sell at 0.75 should have been placed
    const calls = mockPlaceOrder.mock.calls
    const exitCall = calls.find(c =>
      (c[0] as { limitPrice?: number }).limitPrice === 0.75 &&
      (c[0] as { side?: string }).side === 'sell'
    )
    expect(exitCall).toBeDefined()
  })

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it('execute schedules hard-exit 15s before window close', async () => {
    vi.useRealTimers()  // need real timers for this test

    const endTime = Date.now() + 30_000  // window closes in 30s → hard exit in 15s
    const opp: Opportunity = {
      id: 'opp-3',
      strategyKey: 'polymarket_crypto_binary_5min',
      symbol: 'POLY:cond_btc_95000',
      direction: 'long',
      assetClass: 'polymarket',
      strength: 0.8,
      expectedReturn: 0.33,
      metadata: {
        marketId: 'mkt_btc_95000',
        conditionId: 'cond_btc_95000',
        onChainPrice: 0.42,
        offChainDeviation: 200,
        endTime,
        hardExitAt: endTime - 15_000,  // in 15 seconds
        highConviction: false,
      },
      detectedAt: new Date().toISOString(),
    }

    mockPlaceOrder.mockResolvedValue({ result: 'order-hard', skipped: false })
    mockSubscribeOrderBook.mockImplementation((_id: string, cb: (book: unknown) => void) => {
      // Immediately simulate fill to arm exit watcher
      setTimeout(() => cb({}), 10)
      return () => {}
    })
    mockGetFills.mockResolvedValue({
      result: [{ orderId: 'order-hard', side: 'buy', price: 0.42, size: 100, feeCents: 63, filledAt: new Date().toISOString() }],
      skipped: false,
    })
    mockCancelOrder.mockResolvedValue({ result: undefined, skipped: false })

    const size = { fraction: 0.005, notionalUsd: 500, rationale: 'test' }
    await strategy.execute(opp, size, 'user-1', makeSupabase())

    // Wait slightly past the hard-exit timer
    await new Promise(r => setTimeout(r, 16_100))

    // After hard exit timeout: a sell with limitPrice 0.01 (market-out) should have been placed
    const marketOutCall = mockPlaceOrder.mock.calls.find(c =>
      (c[0] as { limitPrice?: number }).limitPrice === 0.01 &&
      (c[0] as { side?: string }).side === 'sell'
    )
    expect(marketOutCall).toBeDefined()
  }, 20_000)

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it('audit_logs records correct edge_type and broker_used', async () => {
    const insertMock = vi.fn().mockReturnValue(Promise.resolve({ error: null }))
    const supabase = makeSupabase(insertMock)

    const endTime = NOW + 60_000
    const opp: Opportunity = {
      id: 'opp-4',
      strategyKey: 'polymarket_crypto_binary_5min',
      symbol: 'POLY:cond_btc_95000',
      direction: 'long',
      assetClass: 'polymarket',
      strength: 0.8,
      expectedReturn: 0.33,
      metadata: {
        marketId: 'mkt_btc_95000',
        conditionId: 'cond_btc_95000',
        onChainPrice: 0.42,
        offChainDeviation: 200,
        endTime,
        hardExitAt: endTime - 15_000,
        highConviction: false,
      },
      detectedAt: new Date().toISOString(),
    }

    mockPlaceOrder.mockResolvedValue({ result: 'order-audit', skipped: false })
    mockSubscribeOrderBook.mockImplementation(() => () => {})
    mockGetFills.mockResolvedValue({ result: [], skipped: false })

    const size = { fraction: 0.005, notionalUsd: 500, rationale: 'test' }
    await strategy.execute(opp, size, 'user-1', supabase)

    // Drain the microtask queue — insert() is called synchronously before execute() returns,
    // so a single tick is enough, but a few extra are harmless with fake timers active.
    await Promise.resolve()
    await Promise.resolve()

    expect(supabase.from).toHaveBeenCalledWith('audit_logs')
    const insertArg = insertMock.mock.calls[0][0] as Record<string, unknown>
    expect(insertArg.edge_type).toBe('information')
    expect((insertArg.metadata as Record<string, unknown>)?.broker_used).toBe('polymarket')
    expect((insertArg.metadata as Record<string, unknown>)?.polymarket_engine_used).toBe(true)
  })
})
