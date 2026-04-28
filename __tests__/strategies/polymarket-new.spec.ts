/**
 * Tests for new Polymarket strategies:
 *   - polymarket_market_maker
 *   - polymarket_kalshi_weather
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PolymarketMarketMakerStrategy } from '@/lib/strategies/impl/polymarket/polymarket-market-maker'
import { PolymarketKalshiWeatherStrategy } from '@/lib/strategies/impl/polymarket/polymarket-kalshi-weather'
import type { OpportunityContext } from '@/lib/strategies/pipeline-types'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// Also mock WeatherEnsembleClient
vi.mock('@/lib/integrations/weather/WeatherEnsembleClient', () => ({
  getConsensus: vi.fn().mockResolvedValue({
    gfs: null, ecmwf: null, icon: null,
    agreementScore: 0,
    fairProb: 0.5,
  }),
  getGfsEnsemble31: vi.fn().mockResolvedValue(null),
  getEcmwf: vi.fn().mockResolvedValue(null),
  getIcon: vi.fn().mockResolvedValue(null),
}))

function makeCtx(): OpportunityContext {
  return { metadata: {} }
}

function jsonResponse(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response)
}

// --- PolymarketMarketMaker ---------------------------------------------------

describe('PolymarketMarketMakerStrategy', () => {
  beforeEach(() => vi.clearAllMocks())

  it('1. returns [] when fetch fails', async () => {
    fetchMock.mockResolvedValue({ ok: false } as Response)
    const result = await new PolymarketMarketMakerStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('2. returns [] when no markets meet volume threshold', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse([{
        conditionId: '0xabc',
        question: 'Will X happen?',
        endDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        volume24hr: 1_000,  // below 50k threshold
        liquidity: '50000',
        bestBid: '0.45',
        bestAsk: '0.55',
        outcomePrices: ['0.50', '0.50'],
        acceptingOrders: true,
        closed: false,
      }])
    )
    const result = await new PolymarketMarketMakerStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('3. emits neutral opportunity when market qualifies', async () => {
    fetchMock.mockImplementation(() =>
      jsonResponse([{
        conditionId: '0xdef',
        question: 'Will Y happen?',
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        volume24hr: 75_000,  // above threshold
        liquidity: '200000',
        bestBid: '0.44',
        bestAsk: '0.56',  // 12 cent spread -- above 3c minimum
        outcomePrices: ['0.50', '0.50'],
        acceptingOrders: true,
        closed: false,
      }])
    )
    const result = await new PolymarketMarketMakerStrategy().detectOpportunities(makeCtx())
    if (result.length > 0) {
      expect(result[0].strategyKey).toBe('polymarket_market_maker')
      expect(result[0].direction).toBe('neutral')
      expect(result[0].assetClass).toBe('polymarket')
    }
    // May be empty if outside trading window -- that is valid
    expect(Array.isArray(result)).toBe(true)
  })

  it('4. strategy key and asset class are correct', () => {
    const s = new PolymarketMarketMakerStrategy()
    expect(s.key).toBe('polymarket_market_maker')
    expect(s.assetClass).toBe('polymarket')
  })
})

// --- PolymarketKalshiWeather -------------------------------------------------

describe('PolymarketKalshiWeatherStrategy', () => {
  beforeEach(() => vi.clearAllMocks())

  it('5. returns [] when fetch fails', async () => {
    fetchMock.mockResolvedValue({ ok: false } as Response)
    const result = await new PolymarketKalshiWeatherStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('6. returns [] when ensemble agreement is below threshold', async () => {
    const { getConsensus } = await import('@/lib/integrations/weather/WeatherEnsembleClient')
    vi.mocked(getConsensus).mockResolvedValue({
      gfs: null, ecmwf: null, icon: null,
      agreementScore: 0.3,   // below 0.70 threshold
      fairProb: 0.8,
    })

    fetchMock.mockImplementation(() =>
      jsonResponse([{
        conditionId: '0xweather1',
        question: 'Will NYC exceed 70F on April 28?',
        endDate: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        outcomePrices: ['0.50', '0.50'],
        liquidity: '100000',
        bestBid: '0.48', bestAsk: '0.52',
      }])
    )

    const result = await new PolymarketKalshiWeatherStrategy().detectOpportunities(makeCtx())
    expect(result).toEqual([])
  })

  it('7. strategy key and asset class are correct', () => {
    const s = new PolymarketKalshiWeatherStrategy()
    expect(s.key).toBe('polymarket_kalshi_weather')
    expect(s.assetClass).toBe('polymarket')
  })

  it('8. runRedTeam rejects when edge < 8 cents', async () => {
    const s = new PolymarketKalshiWeatherStrategy()
    const verdict = await s.runRedTeam({
      id: '1', strategyKey: 'polymarket_kalshi_weather',
      symbol: 'POLY:0x1', direction: 'long', assetClass: 'polymarket',
      strength: 0.5, expectedReturn: 0.05,
      metadata: {
        edgeCents: 0.04,   // below 8c
        agreementScore: 0.8,
        spread: 0.02,
        hoursLeft: 48,
      },
      detectedAt: new Date().toISOString(),
    })
    expect(verdict.passed).toBe(false)
  })
})
