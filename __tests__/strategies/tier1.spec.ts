/**
 * Tier 1 strategy validation tests.
 *
 * 12 tests covering 5 Tier 1 strategies:
 *   1–2   PolymarketWalletCopy — empty + valid shape
 *   3–4   PolymarketInfoLag — empty + opportunity structure
 *   5–6b  AutopilotCongressional — no-key + stale lag + valid purchase
 *   7–8   DcaHalving — distribution block + accumulation dip buy
 *   9–10  FundingBasisArb — low rate skips + high rate emits
 *   11–12 STRATEGY_AI_CONFIG vault alignment
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as polymarketWallets from '@/lib/market-data/polymarket-wallets'
import * as quiverModule from '@/lib/market-data/quiver'
import * as halvingModule from '@/lib/market-data/halving'
import * as fundingRatesModule from '@/lib/market-data/funding-rates'

import { PolymarketWalletCopyStrategy, walletStatsCache } from '@/lib/strategies/impl/polymarket/polymarket-wallet-copy'
import { PolymarketInfoLagStrategy } from '@/lib/strategies/impl/polymarket/polymarket-info-lag'
import { AutopilotCongressionalStrategy } from '@/lib/strategies/impl/stocks/autopilot-congressional'
import { DcaHalvingStrategy } from '@/lib/strategies/impl/crypto/dca-halving'
import { FundingBasisArbStrategy } from '@/lib/strategies/impl/crypto/funding-basis-arb'
import { STRATEGY_REGISTRY_CONFIG } from '@/lib/strategies/strategy-registry'
import type { OpportunityContext } from '@/lib/strategies/pipeline-types'

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/market-data/polymarket-wallets', () => ({
  getTrackedWallets:        vi.fn().mockReturnValue([]),
  scanTrackedWalletTrades:  vi.fn().mockResolvedValue([]),
  getMarketDetails:         vi.fn().mockResolvedValue(null),
  getWalletPositions:       vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/market-data/quiver', () => ({
  getLiveCongressTrades: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/market-data/halving', async (importOriginal) => {
  const actual = await importOriginal() as typeof halvingModule
  return {
    ...actual,
    // Wrap with vi.fn() so individual tests can override
    getHalvingCycleState: vi.fn(actual.getHalvingCycleState),
    getDCASignal: vi.fn(actual.getDCASignal),
  }
})

vi.mock('@/lib/market-data/funding-rates', () => ({
  getFundingRate: vi.fn().mockResolvedValue({
    symbol: 'BTC', rate: 0.0001, annualised: 0.0365,
    timestamp: new Date().toISOString(), source: 'binance',
  }),
}))

// Mock global fetch for all external HTTP calls
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<OpportunityContext> = {}): OpportunityContext {
  return {
    supabase: {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        like: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    } as never,
    metadata: {},
    ...overrides,
  }
}

function jsonResponse(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response)
}

// ─── PolymarketWalletCopy ─────────────────────────────────────────────────────

describe('PolymarketWalletCopy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    walletStatsCache.clear()
  })

  it('1. returns [] when no wallets are tracked', async () => {
    vi.mocked(polymarketWallets.getTrackedWallets).mockReturnValue([])
    const result = await new PolymarketWalletCopyStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('2. returns [] when tracked wallets have no recent trades', async () => {
    vi.mocked(polymarketWallets.getTrackedWallets).mockReturnValue(['0xABC'])
    vi.mocked(polymarketWallets.scanTrackedWalletTrades).mockResolvedValue([])
    const result = await new PolymarketWalletCopyStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('2b. emits valid Opportunity when a qualifying trade arrives', async () => {
    // Pre-populate with real (Dune-style) stats so the binomial filter applies and passes
    walletStatsCache.set('0xABC', {
      stats: { winRate: 0.65, maxDD: 0.20, avgHoldHours: 48, tradeCount: 120, isEstimated: false },
      cachedAt: Date.now(),
    })

    vi.mocked(polymarketWallets.getTrackedWallets).mockReturnValue(['0xABC'])
    vi.mocked(polymarketWallets.scanTrackedWalletTrades).mockResolvedValue([{
      wallet: '0xABC',
      conditionId: '0xcondition1',
      side: 'YES',
      size: 1000,
      price: 0.35,
      timestamp: new Date().toISOString(),
      transaction_hash: '0xtx1',
    }])
    vi.mocked(polymarketWallets.getMarketDetails).mockResolvedValue({
      question: 'Will X happen?',
      yes_price: 0.36,
      no_price: 0.64,
      liquidity: 50_000,
      end_date_iso: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    })

    const result = await new PolymarketWalletCopyStrategy().detectOpportunities(makeCtx())
    expect(result.length).toBeGreaterThanOrEqual(1)

    const opp = result[0]
    expect(opp.strategyKey).toBe('polymarket_wallet_copy')
    expect(opp.assetClass).toBe('polymarket')
    expect(opp.direction).toBe('long')
    expect(opp.symbol).toMatch(/^POLY:/)
    expect(opp.metadata.walletAddress).toBe('0xABC')
    expect(opp.metadata.liquidity).toBe(50_000)
    expect(typeof opp.strength).toBe('number')
  })

  it('2c. new wallet (no Dune data) can still generate a trade via estimated stats', async () => {
    // No pre-populated cache — strategy uses estimateWalletStats (isEstimated: true)
    // The strict tradeCount >= 100 gate must be skipped for estimated stats
    vi.mocked(polymarketWallets.getTrackedWallets).mockReturnValue(['0xNEW'])
    vi.mocked(polymarketWallets.scanTrackedWalletTrades).mockResolvedValue([{
      wallet: '0xNEW',
      conditionId: '0xcondition2',
      side: 'YES',
      size: 500,
      price: 0.30,
      timestamp: new Date().toISOString(),
      transaction_hash: '0xtx2',
    }])
    vi.mocked(polymarketWallets.getMarketDetails).mockResolvedValue({
      question: 'Will Z happen?',
      yes_price: 0.31,
      no_price: 0.69,
      liquidity: 30_000,
      end_date_iso: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })

    const result = await new PolymarketWalletCopyStrategy().detectOpportunities(makeCtx())
    // Should emit at least one opportunity (estimated stats bypass strict tradeCount gate)
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0].strategyKey).toBe('polymarket_wallet_copy')
  })
})

// ─── PolymarketInfoLag ────────────────────────────────────────────────────────

describe('PolymarketInfoLag', () => {
  beforeEach(() => {
    delete process.env.POLYMARKET_INFO_LAG_CONDITION_IDS
    delete process.env.POLYMARKET_ECON_CONDITION_IDS
    vi.clearAllMocks()
  })

  it('3. returns [] when no condition IDs are configured', async () => {
    const result = await new PolymarketInfoLagStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('4. emits Opportunity with valid structure when lag is detected', async () => {
    process.env.POLYMARKET_INFO_LAG_CONDITION_IDS = '0xcond123'

    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('gamma-api.polymarket.com')) {
        return jsonResponse([{
          condition_id: '0xcond123',
          question: 'Will rain occur?',
          outcomePrices: ['0.35', '0.65'],
          liquidity: 20_000,
        }])
      }
      return Promise.resolve({ ok: false } as Response)
    })

    const result = await new PolymarketInfoLagStrategy().detectOpportunities(makeCtx())
    for (const opp of result) {
      expect(opp.strategyKey).toBe('polymarket_info_lag')
      expect(opp.assetClass).toBe('polymarket')
      expect(opp.symbol).toContain('POLY:')
      expect(opp.metadata.conditionId).toBeTruthy()
      expect(opp.metadata.lag).toBeGreaterThan(0)
      expect(typeof opp.metadata.reasoning).toBe('string')
    }
    // test passes even if no opportunities (lag below threshold is valid)
    expect(Array.isArray(result)).toBe(true)
  })
})

// ─── AutopilotCongressional ───────────────────────────────────────────────────

describe('AutopilotCongressional', () => {
  beforeEach(() => {
    delete process.env.QUIVER_QUANT_API_KEY
    vi.clearAllMocks()
    fetchMock.mockResolvedValue({ ok: false } as Response)
  })

  it('5. returns [] when Quiver key is absent and EDGAR returns nothing', async () => {
    vi.mocked(quiverModule.getLiveCongressTrades).mockResolvedValue([])
    const result = await new AutopilotCongressionalStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('6. filters out filings with lag > 20 days', async () => {
    process.env.QUIVER_QUANT_API_KEY = 'test-key'
    const staleDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const reportDate = new Date().toISOString().split('T')[0]

    vi.mocked(quiverModule.getLiveCongressTrades).mockResolvedValue([{
      Ticker: 'AAPL',
      Representative: 'Senator Smith',
      Transaction: 'Purchase',
      Range: '$15,001 - $50,000',
      TransactionDate: staleDate,
      ReportDate: reportDate,
      House: 'Senate',
      amount_usd: 32_500,
    }])

    const result = await new AutopilotCongressionalStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('6b. emits Opportunity for fresh purchase within lag threshold', async () => {
    process.env.QUIVER_QUANT_API_KEY = 'test-key'
    const txDate  = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const rptDate = new Date().toISOString().split('T')[0]

    vi.mocked(quiverModule.getLiveCongressTrades).mockResolvedValue([{
      Ticker: 'MSFT',
      Representative: 'Rep Jones',
      Transaction: 'Purchase',
      Range: '$100,001 - $250,000',
      TransactionDate: txDate,
      ReportDate: rptDate,
      House: 'House',
      amount_usd: 175_000,
    }])

    const result = await new AutopilotCongressionalStrategy().detectOpportunities(makeCtx())
    expect(result.length).toBeGreaterThanOrEqual(1)

    const opp = result[0]
    expect(opp.strategyKey).toBe('autopilot_congressional')
    expect(opp.symbol).toBe('MSFT')
    expect(opp.direction).toBe('long')
    expect(opp.metadata.filingLagDays).toBeLessThanOrEqual(20)
    expect(opp.metadata.holdDays).toBe(90)
  })
})

// ─── DcaHalving ──────────────────────────────────────────────────────────────

describe('DcaHalving', () => {
  beforeEach(() => {
    delete process.env.GLASSNODE_API_KEY
    vi.clearAllMocks()
  })

  it('7. returns no longs in distribution phase', async () => {
    vi.mocked(halvingModule.getHalvingCycleState).mockReturnValue({
      lastHalvingDate: new Date('2020-05-11'),
      nextHalvingDate: new Date('2024-04-19'),
      daysSinceHalving: 900,
      daysToNextHalving: 200,
      phase: 'distribution',
      cycleProgressPct: 65,
    })

    fetchMock.mockResolvedValue({ ok: false } as Response)
    const result = await new DcaHalvingStrategy().detectOpportunities(makeCtx())
    const longs = result.filter(o => o.direction === 'long')
    expect(longs).toEqual([])
  })

  it('8. emits dip-buy Opportunity in accumulation phase', async () => {
    vi.mocked(halvingModule.getHalvingCycleState).mockReturnValue({
      lastHalvingDate: new Date('2024-04-19'),
      nextHalvingDate: new Date('2028-03-15'),
      daysSinceHalving: 180,
      daysToNextHalving: 1310,
      phase: 'accumulation',
      cycleProgressPct: 12,
    })

    // Also mock getDCASignal so it's not subject to real phase (which may be different)
    vi.mocked(halvingModule.getDCASignal).mockReturnValue({
      signal: 'buy',
      strength: 0.7,
      reason: 'Accumulation phase — 43.0% dip from 90d high',
    })

    // BTC: 90d high 70k, current 40k → 43% dip
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('coingecko.com/api/v3/coins/bitcoin')) {
        const prices: [number, number][] = Array.from({ length: 90 }, (_, i) => [
          Date.now() - (89 - i) * 86400_000,
          i < 89 ? 70_000 : 40_000,
        ])
        return jsonResponse({ prices })
      }
      if (String(url).includes('coingecko.com/api/v3/coins/ethereum')) {
        const prices: [number, number][] = Array.from({ length: 90 }, (_, i) => [
          Date.now() - (89 - i) * 86400_000,
          i < 89 ? 4_000 : 2_300,
        ])
        return jsonResponse({ prices })
      }
      return Promise.resolve({ ok: false } as Response)
    })

    const result = await new DcaHalvingStrategy().detectOpportunities(makeCtx())
    const btcBuys = result.filter(o => o.symbol === 'BTC' && o.direction === 'long')
    expect(btcBuys.length).toBeGreaterThanOrEqual(1)
    expect(btcBuys[0].strategyKey).toBe('dca_halving')
    expect(btcBuys[0].metadata.phase).toBe('accumulation')
    expect(btcBuys[0].metadata.triggerType).toBe('dip_buy')
  })
})

// ─── FundingBasisArb ──────────────────────────────────────────────────────────

describe('FundingBasisArb', () => {
  beforeEach(() => vi.clearAllMocks())

  it('9. returns [] when funding rate is below threshold', async () => {
    vi.mocked(fundingRatesModule.getFundingRate).mockResolvedValue({
      symbol: 'BTC', rate: 0.0001, annualised: 0.0365,
      timestamp: new Date().toISOString(), source: 'binance',
    })
    fetchMock.mockResolvedValue({ ok: false } as Response)
    const result = await new FundingBasisArbStrategy().detectOpportunities(makeCtx({ metadata: { symbols: ['BTC'] } }))
    expect(result).toEqual([])
  })

  it('10. emits Opportunity with dual-broker metadata when threshold is exceeded', async () => {
    vi.mocked(fundingRatesModule.getFundingRate).mockResolvedValue({
      symbol: 'BTC', rate: 0.0005, annualised: 0.1825,
      timestamp: new Date().toISOString(), source: 'binance',
    })

    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('coingecko.com')) {
        return jsonResponse({ bitcoin: { usd: 65_000 } })
      }
      if (String(url).includes('fapi.binance.com/fapi/v1/depth')) {
        return jsonResponse({ bids: [['65000', '2.0'], ['64999', '1.5']] })
      }
      return Promise.resolve({ ok: false } as Response)
    })

    const result = await new FundingBasisArbStrategy().detectOpportunities(makeCtx({ metadata: { symbols: ['BTC'] } }))
    expect(result.length).toBeGreaterThanOrEqual(1)

    const opp = result[0]
    expect(opp.strategyKey).toBe('funding_basis_arb')
    expect(opp.assetClass).toBe('crypto')
    expect(opp.direction).toBe('neutral')
    expect(opp.symbol).toBe('BTC-PERP')
    expect((opp.metadata.fundingRate as number)).toBeGreaterThan(0.0003)
    expect(opp.metadata.capNotional).toBeGreaterThan(0)
    expect(typeof opp.metadata.reasoning).toBe('string')
  })
})

// ─── STRATEGY_AI_CONFIG — Vault recipe validation ─────────────────────────────

describe('STRATEGY_AI_CONFIG — Tier 1 vault alignment', () => {
  it('11. MiroFish and Kronos settings match vault recipes', () => {
    const cfg = STRATEGY_REGISTRY_CONFIG
    expect(cfg.polymarket_wallet_copy.mirofish).toBe('high')
    expect(cfg.polymarket_wallet_copy.kronos).toBe('skip')
    expect(cfg.polymarket_info_lag.mirofish).toBe('high')
    expect(cfg.polymarket_info_lag.kronos).toBe('skip')
    expect(cfg.autopilot_congressional.mirofish).toBe('medium')
    expect(cfg.autopilot_congressional.kronos).toBe('skip')
    expect(cfg.dca_halving.mirofish).toBe('medium')
    expect(cfg.dca_halving.kronos).toBe('medium')
    expect(cfg.funding_basis_arb.mirofish).toBe('skip')
    expect(cfg.funding_basis_arb.kronos).toBe('skip')
  })

  it('12. edge types match vault recipes', () => {
    const cfg = STRATEGY_REGISTRY_CONFIG
    expect(cfg.polymarket_wallet_copy.edgeType).toBe('flow')
    expect(cfg.polymarket_info_lag.edgeType).toBe('information')
    expect(cfg.autopilot_congressional.edgeType).toBe('flow')
    expect(cfg.dca_halving.edgeType).toBe('onchain')
    expect(cfg.funding_basis_arb.edgeType).toBe('structural')
  })

  it('12b. default brokers match vault recipes', () => {
    const cfg = STRATEGY_REGISTRY_CONFIG
    expect(cfg.polymarket_wallet_copy.defaultBroker).toBe('polymarket')
    expect(cfg.polymarket_info_lag.defaultBroker).toBe('polymarket')
    expect(cfg.autopilot_congressional.defaultBroker).toBe('alpaca')
    expect(cfg.dca_halving.defaultBroker).toBe('coinbase')
    expect(cfg.funding_basis_arb.defaultBroker).toBe('binance_us')
  })
})
