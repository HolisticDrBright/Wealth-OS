/**
 * Tier 3 strategy tests — 4+ tests per strategy, 32 total.
 *
 * All external data modules are mocked so tests are deterministic
 * and do not require live API access.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { OpenPosition, PriceTick, OpportunityContext } from '@/lib/strategies/pipeline-types'

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/market-data/sec-edgar', () => ({
  fetchForm4Filings: vi.fn().mockResolvedValue([]),
  search13DG: vi.fn().mockResolvedValue([]),
  has13DG: vi.fn().mockResolvedValue(false),
  isExecutiveOrBoard: vi.fn((role: string) => role === 'officer' || role === 'director'),
}))

vi.mock('@/lib/market-data/buyback-scanner', () => ({
  fetchBuybackAnnouncements: vi.fn().mockResolvedValue([]),
  getTickerMeta: vi.fn().mockResolvedValue(null),
  hasSimultaneousSecondaryOffering: vi.fn().mockResolvedValue(false),
  isExtensionOfExistingProgram: vi.fn().mockResolvedValue(false),
  checkDebtFunded: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/lib/market-data/coinglass', () => ({
  getFundingApr: vi.fn().mockResolvedValue(null),
  getBatchFundingApr: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock('@/lib/market-data/defi-llama', () => ({
  getRwaApy: vi.fn().mockResolvedValue(null),
  getBestAaveStablecoinApy: vi.fn().mockResolvedValue(0.03),
  getProjectPools: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/market-data/fred-api', () => ({
  getTbill4WeekYield: vi.fn().mockResolvedValue(0.05),
  getFredSeries: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/market-data/lido-protocol', () => ({
  getLstPoolPrice: vi.fn().mockResolvedValue(null),
  getWithdrawalQueueDays: vi.fn().mockResolvedValue(5),
  getAccumulatedYieldRatio: vi.fn().mockResolvedValue(1.0),
}))

vi.mock('@/lib/market-data/sportsbook', () => ({
  getPinnacleOdds: vi.fn().mockResolvedValue([]),
  matchEventsAcrossPlatforms: vi.fn().mockReturnValue([]),
  resolutionCriteriaIdentical: vi.fn().mockReturnValue(false),
  sportsbookCancelled: vi.fn().mockResolvedValue(false),
  isEventResolved: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/lib/market-data/polymarket-wallets', () => ({
  getTrackedWallets: vi.fn().mockReturnValue([]),
  scanTrackedWalletTrades: vi.fn().mockResolvedValue([]),
  getMarketDetails: vi.fn().mockResolvedValue(null),
  getWalletPositions: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/strategies/cadence-helpers', () => ({
  isAfterMarketClose: vi.fn().mockReturnValue(true),
  isMondayEt: vi.fn().mockReturnValue(true),
  isLastBusinessDayOfMonth: vi.fn().mockReturnValue(true),
  isLastBusinessDayOfMonthTz: vi.fn().mockReturnValue(true),
  utcHourDecimal: vi.fn().mockReturnValue(14.5),
  londonHourDecimal: vi.fn().mockReturnValue(14.5),  // pre-fix window (London wall clock)
  isPreOvernightRoll: vi.fn().mockReturnValue(true),
  isHighImpactNewsDay: vi.fn().mockReturnValue(false),
  isNfpWeek: vi.fn().mockReturnValue(false),
  hourEt: vi.fn().mockReturnValue(16),
  minuteEt: vi.fn().mockReturnValue(45),
  dowEt: vi.fn().mockReturnValue(1),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeCtx = (overrides: Partial<OpportunityContext> = {}): OpportunityContext => ({
  metadata: {},
  ...overrides,
})

function makePosition(overrides: Partial<OpenPosition> = {}): OpenPosition {
  return {
    id: 'pos-1',
    strategyKey: 'activist_13d_insider_cluster',
    symbol: 'AAPL',
    assetClass: 'stocks',
    direction: 'long',
    entryPrice: 100,
    currentPrice: 100,
    quantity: 10,
    notionalUsd: 1000,
    openedAt: Date.now() - 86_400_000,  // 1 day ago
    metadata: {},
    ...overrides,
  }
}

function makeTick(price: number, symbol = 'AAPL'): PriceTick {
  return { symbol, price, timestamp: Date.now() }
}

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import * as secEdgar from '@/lib/market-data/sec-edgar'
import * as buybackScanner from '@/lib/market-data/buyback-scanner'
import * as coinglassModule from '@/lib/market-data/coinglass'
import * as defiLlamaModule from '@/lib/market-data/defi-llama'
import * as fredModule from '@/lib/market-data/fred-api'
import * as lidoModule from '@/lib/market-data/lido-protocol'
import * as cadenceHelpers from '@/lib/strategies/cadence-helpers'

import { Activist13dInsiderClusterStrategy } from '@/lib/strategies/impl/stocks/activist-13d-insider-cluster'
import { BuybackAnnouncementMomentumStrategy } from '@/lib/strategies/impl/stocks/buyback-announcement-momentum'
import { EtfBasisArbStrategy } from '@/lib/strategies/impl/crypto/etf-basis-arb'
import { LstBasisArbStrategy } from '@/lib/strategies/impl/crypto/lst-basis-arb'
import { RwaYieldStackStrategy } from '@/lib/strategies/impl/crypto/rwa-yield-stack'
import { London4pmFixEndmonthStrategy } from '@/lib/strategies/impl/forex/london-4pm-fix-endmonth'
import { SwapPointArbitrageStrategy } from '@/lib/strategies/impl/forex/swap-point-arbitrage'
import { PredictionMarketSportsbookArbStrategy } from '@/lib/strategies/impl/polymarket/prediction-market-sportsbook-arb'

// ─── T3.1 Activist 13D Insider Cluster ───────────────────────────────────────

describe('Activist13dInsiderCluster', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(cadenceHelpers.isAfterMarketClose).mockReturnValue(true)
    vi.mocked(secEdgar.fetchForm4Filings).mockResolvedValue([])
    vi.mocked(secEdgar.has13DG).mockResolvedValue(false)
    vi.mocked(secEdgar.isExecutiveOrBoard).mockReturnValue(false)
    vi.mocked(buybackScanner.getTickerMeta).mockResolvedValue(null)
  })

  it('1. returns [] outside market close window', async () => {
    vi.mocked(cadenceHelpers.isAfterMarketClose).mockReturnValue(false)
    const result = await new Activist13dInsiderClusterStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('2. returns [] when fewer than 3 insider buys found', async () => {
    vi.mocked(secEdgar.fetchForm4Filings).mockResolvedValue([
      { ticker: 'AAPL', insider_id: 'id1', insider_role: 'officer', transaction_type: 'purchase', notional_usd: 200_000, filed: '2026-01-01', is_10b5_1: false },
      { ticker: 'AAPL', insider_id: 'id2', insider_role: 'director', transaction_type: 'purchase', notional_usd: 150_000, filed: '2026-01-02', is_10b5_1: false },
    ])
    vi.mocked(secEdgar.isExecutiveOrBoard).mockReturnValue(true)
    const result = await new Activist13dInsiderClusterStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('3. emits Opportunity when cluster of 3+ distinct-exec buys found', async () => {
    vi.mocked(secEdgar.fetchForm4Filings).mockResolvedValue([
      { ticker: 'NVDA', insider_id: 'id1', insider_role: 'officer', transaction_type: 'purchase', notional_usd: 200_000, filed: '2026-01-01', is_10b5_1: false },
      { ticker: 'NVDA', insider_id: 'id2', insider_role: 'director', transaction_type: 'purchase', notional_usd: 150_000, filed: '2026-01-02', is_10b5_1: false },
      { ticker: 'NVDA', insider_id: 'id3', insider_role: 'officer', transaction_type: 'purchase', notional_usd: 300_000, filed: '2026-01-03', is_10b5_1: false },
    ])
    vi.mocked(secEdgar.isExecutiveOrBoard).mockReturnValue(true)
    vi.mocked(secEdgar.has13DG).mockResolvedValue(false)
    vi.mocked(buybackScanner.getTickerMeta).mockResolvedValue({
      last_close: 500, market_cap: 5_000_000_000, profit_margin: 0.25,
    })
    const result = await new Activist13dInsiderClusterStrategy().detectOpportunities(makeCtx())
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0].strategyKey).toBe('activist_13d_insider_cluster')
    expect(result[0].direction).toBe('long')
    expect(result[0].bracket?.stopPrice).toBeGreaterThan(0)
  })

  it('4. manageOpenPosition closes when 13D filed after entry', async () => {
    vi.mocked(secEdgar.has13DG).mockResolvedValue(true)
    const strat = new Activist13dInsiderClusterStrategy()
    const action = await strat.manageOpenPosition(
      makePosition({ metadata: { ticker: 'NVDA' } }),
      makeTick(510, 'NVDA')
    )
    expect(action.type).toBe('close')
    expect((action as { type: 'close'; reason: string }).reason).toMatch(/13D/)
  })
})

// ─── T3.2 Buyback Announcement Momentum ──────────────────────────────────────

describe('BuybackAnnouncementMomentum', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(cadenceHelpers.isAfterMarketClose).mockReturnValue(true)
    vi.mocked(buybackScanner.fetchBuybackAnnouncements).mockResolvedValue([])
    vi.mocked(buybackScanner.getTickerMeta).mockResolvedValue(null)
    vi.mocked(buybackScanner.hasSimultaneousSecondaryOffering).mockResolvedValue(false)
    vi.mocked(buybackScanner.isExtensionOfExistingProgram).mockResolvedValue(false)
    vi.mocked(buybackScanner.checkDebtFunded).mockResolvedValue(false)
  })

  it('5. returns [] outside market close window', async () => {
    vi.mocked(cadenceHelpers.isAfterMarketClose).mockReturnValue(false)
    const result = await new BuybackAnnouncementMomentumStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('6. returns [] when no announcements found', async () => {
    vi.mocked(buybackScanner.fetchBuybackAnnouncements).mockResolvedValue([])
    const result = await new BuybackAnnouncementMomentumStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('7. emits Opportunity when qualifying buyback found', async () => {
    vi.mocked(buybackScanner.fetchBuybackAnnouncements).mockResolvedValue([{
      ticker: 'MSFT', size_usd: 5_000_000_000, announced_at: '2026-01-01',
      is_extension: false, is_secondary_offering: false,
    }])
    vi.mocked(buybackScanner.getTickerMeta).mockResolvedValue({
      last_close: 400, market_cap: 50_000_000_000, profit_margin: 0.35,
    })
    const result = await new BuybackAnnouncementMomentumStrategy().detectOpportunities(makeCtx())
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0].strategyKey).toBe('buyback_announcement_momentum')
    expect(result[0].direction).toBe('long')
  })

  it('8. manageOpenPosition closes after 30-day timeout', async () => {
    const strat = new BuybackAnnouncementMomentumStrategy()
    const action = await strat.manageOpenPosition(
      makePosition({ openedAt: Date.now() - 31 * 86_400_000 }),
      makeTick(100)
    )
    expect(action.type).toBe('close')
    expect((action as { type: 'close'; reason: string }).reason).toMatch(/30-day/)
  })
})

// ─── T3.3 ETF Basis Arb ───────────────────────────────────────────────────────

describe('EtfBasisArb', () => {
  beforeEach(() => vi.clearAllMocks())

  it('9. returns [] when funding APR below threshold', async () => {
    vi.mocked(coinglassModule.getFundingApr).mockResolvedValue(0.05)  // 5% < 8% threshold
    const result = await new EtfBasisArbStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('10. returns [] when CoinGlass returns null', async () => {
    vi.mocked(coinglassModule.getFundingApr).mockResolvedValue(null)
    const result = await new EtfBasisArbStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('11. emits Opportunity when funding APR exceeds 8%', async () => {
    vi.mocked(coinglassModule.getFundingApr).mockResolvedValue(0.15)  // 15% APR
    // Mock Yahoo Finance ETF price
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        chart: { result: [{ meta: { regularMarketPrice: 50 } }] }
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await new EtfBasisArbStrategy().detectOpportunities(makeCtx())
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0].strategyKey).toBe('etf_basis_arb')
    expect(result[0].direction).toBe('neutral')
  })

  it('12. manageOpenPosition closes when APR goes negative', async () => {
    vi.mocked(coinglassModule.getFundingApr).mockResolvedValue(-0.02)
    const strat = new EtfBasisArbStrategy()
    const action = await strat.manageOpenPosition(
      makePosition({ metadata: { perp: 'BTCUSDT' } }),
      makeTick(50, 'IBIT_BTCUSDT_BASIS')
    )
    expect(action.type).toBe('close')
    expect((action as { type: 'close'; reason: string }).reason).toMatch(/negative/)
  })
})

// ─── T3.4 LST Basis Arb ───────────────────────────────────────────────────────

describe('LstBasisArb', () => {
  beforeEach(() => vi.clearAllMocks())

  it('13. returns [] when queue > 30 days', async () => {
    vi.mocked(lidoModule.getWithdrawalQueueDays).mockResolvedValue(35)
    const result = await new LstBasisArbStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('14. returns [] when LST discount below 0.5%', async () => {
    vi.mocked(lidoModule.getLstPoolPrice).mockResolvedValue({
      lstSymbol: 'stETH', lstPriceUsd: 2998, ethPriceUsd: 3000,
      fairRatio: 1.0, discountPct: 0.0007,   // 0.07% < threshold
    })
    const result = await new LstBasisArbStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('15. emits Opportunity when LST discount exceeds 0.5%', async () => {
    vi.mocked(lidoModule.getWithdrawalQueueDays).mockResolvedValue(5)
    vi.mocked(lidoModule.getLstPoolPrice).mockResolvedValue({
      lstSymbol: 'stETH', lstPriceUsd: 2940, ethPriceUsd: 3000,
      fairRatio: 1.0, discountPct: 0.02,   // 2% discount
    })
    const result = await new LstBasisArbStrategy().detectOpportunities(makeCtx())
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0].strategyKey).toBe('lst_basis_arb')
    expect(result[0].direction).toBe('long')
    expect(result[0].metadata.discountPct).toBeCloseTo(0.02)
  })

  it('16. manageOpenPosition closes after 14-day timeout', async () => {
    const strat = new LstBasisArbStrategy()
    const action = await strat.manageOpenPosition(
      makePosition({ openedAt: Date.now() - 15 * 86_400_000, metadata: { lstSymbol: 'stETH' } }),
      makeTick(3000, 'stETH-USD')
    )
    expect(action.type).toBe('close')
    expect((action as { type: 'close'; reason: string }).reason).toMatch(/14-day/)
  })
})

// ─── T3.5 RWA Yield Stack ─────────────────────────────────────────────────────

describe('RwaYieldStack', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(cadenceHelpers.isMondayEt).mockReturnValue(true)
    vi.mocked(fredModule.getTbill4WeekYield).mockResolvedValue(0.05)
    vi.mocked(defiLlamaModule.getBestAaveStablecoinApy).mockResolvedValue(0.03)
    vi.mocked(defiLlamaModule.getRwaApy).mockResolvedValue(null)
  })

  it('17. returns [] when not Monday', async () => {
    vi.mocked(cadenceHelpers.isMondayEt).mockReturnValue(false)
    const result = await new RwaYieldStackStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('18. returns [] when APY below T-bill yield', async () => {
    vi.mocked(fredModule.getTbill4WeekYield).mockResolvedValue(0.055)
    vi.mocked(defiLlamaModule.getRwaApy).mockResolvedValue(0.04)  // below T-bill
    const result = await new RwaYieldStackStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('19. emits Opportunity when APY beats T-bill by >= spread', async () => {
    vi.mocked(fredModule.getTbill4WeekYield).mockResolvedValue(0.05)
    vi.mocked(defiLlamaModule.getBestAaveStablecoinApy).mockResolvedValue(0.04)
    vi.mocked(defiLlamaModule.getRwaApy).mockResolvedValue(0.07)  // 7% > 5% T-bill
    const result = await new RwaYieldStackStrategy().detectOpportunities(makeCtx())
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0].strategyKey).toBe('rwa_yield_stack')
    expect(result[0].direction).toBe('long')
    expect(result[0].metadata.apy).toBeGreaterThan(0.05)
  })

  it('20. manageOpenPosition closes on de-peg (price deviates > 1% from $1)', async () => {
    const strat = new RwaYieldStackStrategy()
    const action = await strat.manageOpenPosition(
      makePosition({ symbol: 'USDY', metadata: { poolId: 'usdy', tbillYield: 0.05 } }),
      makeTick(0.98, 'USDY')  // 2% de-peg
    )
    expect(action.type).toBe('close')
    expect((action as { type: 'close'; reason: string }).reason).toMatch(/de-peg/)
  })
})

// ─── T3.6 London 4pm Fix End-of-Month ────────────────────────────────────────

describe('London4pmFixEndmonth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, json: vi.fn().mockResolvedValue({}),
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('21. returns [] when not last business day of month (Europe/London)', async () => {
    vi.mocked(cadenceHelpers.isLastBusinessDayOfMonthTz).mockReturnValue(false)
    const result = await new London4pmFixEndmonthStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('22. returns [] on high-impact news day', async () => {
    vi.mocked(cadenceHelpers.isHighImpactNewsDay).mockReturnValue(true)
    const result = await new London4pmFixEndmonthStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('23. returns [] when outside London fix window', async () => {
    vi.mocked(cadenceHelpers.londonHourDecimal).mockReturnValue(13.0)  // 13:00 London — before window
    const result = await new London4pmFixEndmonthStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('24. manageOpenPosition closes at forceExitAtMs', async () => {
    const strat = new London4pmFixEndmonthStrategy()
    const action = await strat.manageOpenPosition(
      makePosition({ metadata: { forceExitAtMs: Date.now() - 1000 } }),
      makeTick(1.10, 'EURUSD')
    )
    expect(action.type).toBe('close')
    expect((action as { type: 'close'; reason: string }).reason).toMatch(/force exit/)
  })
})

// ─── T3.7 Swap Point Arbitrage ────────────────────────────────────────────────

describe('SwapPointArbitrage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('25. returns [] outside pre-roll window', async () => {
    vi.mocked(cadenceHelpers.isPreOvernightRoll).mockReturnValue(false)
    const result = await new SwapPointArbitrageStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('26. returns [] when OANDA_API_KEY is not set', async () => {
    delete process.env.OANDA_API_KEY
    const result = await new SwapPointArbitrageStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('27. manageOpenPosition closes when swap edge compressed below 50%', async () => {
    // Stub OANDA fetch to return a tiny swap rate
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ financing: { longRate: 0.0001, shortRate: 0.0001 } }),
    }))
    process.env.OANDA_API_KEY = 'test-key'

    const strat = new SwapPointArbitrageStrategy()
    const action = await strat.manageOpenPosition(
      makePosition({ metadata: { pair: 'AUDJPY', originalEdge: 0.001 } }),
      makeTick(90, 'AUDJPY')
    )
    // 0.0001 + 0.0001 = 0.0002, original was 0.001 → compressed to 20% of entry
    expect(action.type).toBe('close')
  })

  it('28. runRedTeam rejects when edge below 5x costs', async () => {
    const strat = new SwapPointArbitrageStrategy()
    const verdict = await strat.runRedTeam({
      id: 'x', strategyKey: 'swap_point_arbitrage', symbol: 'AUDJPY', direction: 'neutral',
      assetClass: 'forex', strength: 0.5, expectedReturn: 0.001,
      metadata: { totalEdge: 0.0002, costs: 0.0003 },  // edge < 5x costs
      detectedAt: new Date().toISOString(),
    })
    expect(verdict.passed).toBe(false)
  })
})

// ─── T3.8 Prediction Market × Sportsbook Arb ─────────────────────────────────

describe('PredictionMarketSportsbookArb', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const sb = await import('@/lib/market-data/sportsbook')
    vi.mocked(sb.isEventResolved).mockResolvedValue(false)
    vi.mocked(sb.sportsbookCancelled).mockResolvedValue(false)
    vi.mocked(sb.matchEventsAcrossPlatforms).mockReturnValue([])
  })

  it('29. returns [] when PINNACLE_API_KEY is not set', async () => {
    delete process.env.PINNACLE_API_KEY
    const result = await new PredictionMarketSportsbookArbStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('30. returns [] when no matches found', async () => {
    process.env.PINNACLE_API_KEY = 'test-key'
    const { matchEventsAcrossPlatforms } = await import('@/lib/market-data/sportsbook')
    vi.mocked(matchEventsAcrossPlatforms).mockReturnValue([])
    const result = await new PredictionMarketSportsbookArbStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('31. manageOpenPosition closes when event resolved', async () => {
    const { isEventResolved } = await import('@/lib/market-data/sportsbook')
    vi.mocked(isEventResolved).mockResolvedValue(true)
    const strat = new PredictionMarketSportsbookArbStrategy()
    const action = await strat.manageOpenPosition(
      makePosition({ metadata: { eventId: 'evt-123', sbLeg: {} } }),
      makeTick(0.8, 'POLY:evt-123')
    )
    expect(action.type).toBe('close')
    expect((action as { type: 'close'; reason: string }).reason).toMatch(/resolved/)
  })

  it('32. manageOpenPosition closes after 30-day timeout', async () => {
    const strat = new PredictionMarketSportsbookArbStrategy()
    const action = await strat.manageOpenPosition(
      makePosition({ openedAt: Date.now() - 31 * 86_400_000, metadata: { eventId: 'evt-1', sbLeg: {} } }),
      makeTick(0.5, 'POLY:evt-1')
    )
    expect(action.type).toBe('close')
    expect((action as { type: 'close'; reason: string }).reason).toMatch(/30-day/)
  })
})
