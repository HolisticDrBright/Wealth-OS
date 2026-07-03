/**
 * Funding-rate sign fixes — table-driven over funding ∈ {+0.03%, −0.03%}.
 *
 * Three bugs, all sign-related:
 *  1. FundingRateArbStrategy set expectedReturn = -fundingRate, so a
 *     positive-funding signal (short perp COLLECTS funding) looked like a loss.
 *  2. Tier-1 FundingBasisArb fed assessBasisArb's SIGNED yield into
 *     expectedReturn — the long_perp (negative funding) case sized to zero.
 *  3. The pipeline impl fabricated perp price from the funding rate
 *     (perp = spot×(1+rate×3)), making its basis check circular, and only
 *     traded the positive-funding side.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock market data BEFORE importing strategies ─────────────────────────────

const { mockGetFundingRate, mockGetPerpMarkPrice } = vi.hoisted(() => ({
  mockGetFundingRate: vi.fn(),
  mockGetPerpMarkPrice: vi.fn(),
}))

vi.mock('@/lib/market-data/funding-rates', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/market-data/funding-rates')>()
  return {
    ...orig,
    getFundingRate: mockGetFundingRate,
    getPerpMarkPrice: mockGetPerpMarkPrice,
  }
})

// The impl also fetches spot + book depth via global fetch.
function mockSpotAndDepth(spotUsd: number) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('coingecko')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ bitcoin: { usd: spotUsd } }) })
    }
    if (typeof url === 'string' && url.includes('depth')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ bids: [['100000', '10']] }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }))
}

import { FundingRateArbStrategy } from '@/lib/strategies/all-strategies'
import { assessBasisArb } from '@/lib/market-data/funding-rates'

const CASES = [
  { label: 'positive funding (+0.03%/8h)', rate: 0.0003, expectSide: 'sell', expectCarry: 'short_perp' },
  { label: 'negative funding (−0.03%/8h)', rate: -0.0003, expectSide: 'buy', expectCarry: 'long_perp' },
] as const

describe('assessBasisArb (sign semantics documented)', () => {
  it.each(CASES)('$label → viable, side=$expectCarry, signed yield', ({ rate, expectCarry }) => {
    const r = assessBasisArb(rate, 0.0001)
    expect(r.viable).toBe(true)
    expect(r.side).toBe(expectCarry)
    // yield is signed — the carry COLLECTED is the magnitude
    expect(Math.sign(r.annualisedYield)).toBe(Math.sign(rate))
    expect(Math.abs(r.annualisedYield)).toBeCloseTo(Math.abs(rate) * 3 * 365, 10)
  })
})

describe('FundingRateArbStrategy (legacy) — bug 1', () => {
  it.each(CASES)('$label → side=$expectSide, expectedReturn POSITIVE, sized > 0', async ({ rate, expectSide }) => {
    const strat = new FundingRateArbStrategy()
    const signal = await strat.generateSignal('BTC', [], { funding_rate: rate * 10 })  // scale past 0.001 gate
    expect(signal).not.toBeNull()
    expect(signal!.side).toBe(expectSide)
    // The correct side COLLECTS |funding| — never a negative expected return.
    expect(signal!.expectedReturn).toBeGreaterThan(0)
    expect(signal!.strength).toBeGreaterThan(0)
  })
})

describe('Tier-1 FundingBasisArbStrategy — bug 2', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(CASES)('$label → perp side=$expectSide, expectedReturn POSITIVE, sized > 0', async ({ rate, expectSide, expectCarry }) => {
    const { FundingBasisArbStrategy } = await import('@/lib/strategies/tier1/index')
    const strat = new FundingBasisArbStrategy()
    const bars = [{ date: '2026-07-01', symbol: 'BTC', open: 1, high: 1, low: 1, close: 1, volume: 1 }]
    // Scale past the strategy's 0.05%/8h viability threshold, keeping the sign.
    const scaled = rate * 2
    const signal = await strat.generateSignal('BTC', bars, { funding_rate: scaled })

    expect(signal).not.toBeNull()
    expect(signal!.side).toBe(expectSide)
    expect(signal!.metadata?.arb_side).toBe(expectCarry)
    // Monthly carry magnitude — the long_perp case used to come out negative.
    expect(signal!.expectedReturn).toBeGreaterThan(0)
    expect(signal!.expectedReturn).toBeCloseTo(Math.abs(scaled) * 3 * 365 / 12, 10)
    expect(signal!.strength).toBeGreaterThan(0)
  })
})

describe('Pipeline funding-basis-arb impl — bug 3', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    // Pin the clock mid-window (04:00 UTC = 240 min to the 08:00 settlement)
    // so the 30-min settlement buffer never skips entries — deterministic
    // regardless of the wall-clock time the suite runs at.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-03T04:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function detect(rate: number, spot: number, perpMark: number | null) {
    mockGetFundingRate.mockResolvedValue({
      symbol: 'BTC', rate, annualised: rate * 3 * 365,
      timestamp: new Date().toISOString(), source: 'binance',
    })
    mockGetPerpMarkPrice.mockResolvedValue(perpMark)
    mockSpotAndDepth(spot)

    const { FundingBasisArbStrategy } = await import('@/lib/strategies/impl/crypto/funding-basis-arb')
    const impl = new FundingBasisArbStrategy()
    return impl.detectOpportunities({ metadata: { symbols: ['BTC'] } } as never)
  }

  it('positive funding + REAL perp premium → short_perp opportunity, positive expectedReturn', async () => {
    const opps = await detect(0.0004, 100_000, 100_200)  // +20bps real premium
    expect(opps).toHaveLength(1)
    expect(opps[0].metadata.carrySide).toBe('short_perp')
    expect(opps[0].expectedReturn).toBeGreaterThan(0)
    expect(opps[0].strength).toBeGreaterThan(0)
    expect(opps[0].metadata.perpPrice).toBe(100_200)  // real, not fabricated
  })

  it('NEGATIVE funding + real perp discount → long_perp opportunity (previously skipped)', async () => {
    const opps = await detect(-0.0004, 100_000, 99_800)  // −20bps real discount
    expect(opps).toHaveLength(1)
    expect(opps[0].metadata.carrySide).toBe('long_perp')
    expect(opps[0].expectedReturn).toBeGreaterThan(0)
    expect(opps[0].strength).toBeGreaterThan(0)
  })

  it('basis contradicting the funding sign → NO opportunity (the old circular check always passed)', async () => {
    // Positive funding but the perp trades at a DISCOUNT — carry and basis disagree.
    const opps = await detect(0.0004, 100_000, 99_900)
    expect(opps).toHaveLength(0)
  })

  it('perp mark price unavailable → skip, never fabricate from the funding rate', async () => {
    const opps = await detect(0.0004, 100_000, null)
    expect(opps).toHaveLength(0)
  })
})
