/**
 * CexLatencyArbStrategy — 3 unit tests
 *
 * Tests:
 *  1. detectOpportunities returns [] when no lag >= 8 bps
 *  2. detectOpportunities returns Opportunity when lag > 8 bps net of fees
 *  3. sizePosition respects 0.25% per-leg cap (0.5% combined)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CexLatencyArbStrategy } from '@/lib/strategies/impl/crypto/cex-latency-arb'
import type { Opportunity, AllVerdicts } from '@/lib/strategies/pipeline-types'

function makeSupabase(): SupabaseClient {
  return {
    from: vi.fn().mockReturnValue({ insert: vi.fn().mockReturnValue(Promise.resolve({ error: null })) }),
  } as unknown as SupabaseClient
}

function makeAllVerdicts(): AllVerdicts {
  return {
    mirofish: null,
    kronos: null,
    redTeam: { passed: true, score: 70 },
    risk: { veto: false, kellyFraction: 0.04 },
  }
}

// Helper: mock fetch to return top-of-book prices for all 3 venues
function mockTopOfBook(prices: {
  coinbase?: { bid: number; ask: number }
  kraken?: { bid: number; ask: number }
  binance?: { bid: number; ask: number }
}) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    const u = typeof url === 'string' ? url : ''

    if (u.includes('coinbase.com') && u.includes('best_bid_ask')) {
      if (!prices.coinbase) return Promise.reject(new Error('no coinbase'))
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          pricebooks: [{ bids: [{ price: String(prices.coinbase!.bid) }], asks: [{ price: String(prices.coinbase!.ask) }] }],
        }),
      })
    }
    if (u.includes('kraken.com')) {
      if (!prices.kraken) return Promise.reject(new Error('no kraken'))
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: { XBTUSD: { b: [String(prices.kraken!.bid)], a: [String(prices.kraken!.ask)] } } }),
      })
    }
    if (u.includes('binance.us')) {
      if (!prices.binance) return Promise.reject(new Error('no binance'))
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ bidPrice: String(prices.binance!.bid), askPrice: String(prices.binance!.ask) }),
      })
    }
    return Promise.reject(new Error('unmatched url'))
  }))
}

describe('CexLatencyArbStrategy', () => {
  let strategy: CexLatencyArbStrategy

  beforeEach(() => {
    strategy = new CexLatencyArbStrategy()
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('returns [] when spread < 8 bps net of fees', async () => {
    // Coinbase ask = 50000, Kraken bid = 50001 → spread = 2 bps; 2 - 20 fees = -18 bps
    mockTopOfBook({
      coinbase: { bid: 49998, ask: 50000 },
      kraken:   { bid: 50001, ask: 50003 },
      binance:  { bid: 49999, ask: 50001 },
    })

    const opps = await strategy.detectOpportunities({
      supabase: makeSupabase(),
      metadata: { userId: 'user-1', userEnabledStrategies: ['cex_latency_arb'] },
    })

    expect(opps).toHaveLength(0)
  })

  it('returns Opportunity when one venue lags by > 8 bps net of fees', async () => {
    // Coinbase ask = 50000, Kraken bid = 50600 → spread = 120 bps; 120 - 20 fees = 100 bps net
    mockTopOfBook({
      coinbase: { bid: 49990, ask: 50000 },
      kraken:   { bid: 50600, ask: 50620 },
      binance:  { bid: 50001, ask: 50011 },
    })

    const opps = await strategy.detectOpportunities({
      supabase: makeSupabase(),
      metadata: { userId: 'user-1', userEnabledStrategies: ['cex_latency_arb'] },
    })

    expect(opps.length).toBeGreaterThan(0)
    const opp = opps[0]
    expect(opp.strategyKey).toBe('cex_latency_arb')
    expect(opp.metadata.netBpsAfterFees).toBeGreaterThanOrEqual(8)
    expect(opp.metadata.longVenue).toBe('coinbase')
    expect(opp.metadata.shortVenue).toBe('kraken')
  })

  it('sizePosition respects 0.25% per-leg cap', async () => {
    const opp: Opportunity = {
      id: 'arb-1',
      strategyKey: 'cex_latency_arb',
      symbol: 'BTC-ARB',
      direction: 'long',
      assetClass: 'crypto',
      strength: 0.8,
      expectedReturn: 0.01,
      metadata: { longVenue: 'coinbase', shortVenue: 'kraken', netBpsAfterFees: 50 },
      detectedAt: new Date().toISOString(),
    }

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

    const size = await strategy.sizePosition(opp, makeAllVerdicts(), 'user-1', makeSupabase())

    // 0.25% per leg × $100k = $250 per leg
    expect(size.fraction).toBeLessThanOrEqual(0.0025)
    expect(size.notionalUsd).toBeLessThanOrEqual(250)
    expect(size.notionalUsd).toBeGreaterThan(0)
  })
})
