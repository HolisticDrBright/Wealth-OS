/**
 * Item 6 — batch of small correctness bugs, one test block per fix:
 *  1. cron route fails CLOSED when CRON_SECRET is unset
 *  2. PositionMonitor throws instead of silently using the anon key
 *  3. stddev guards: flat series → no signal (was NaN strength)
 *  4. London 4pm fix uses Europe/London wall-clock (DST-correct)
 *  5. VCP ATR gets period+1 bars (14 TRs / 14, not 13 / 14)
 *  6. 52-week breakout requires 252 daily bars (not 52)
 *  7. congressional high-alpha filter: full-name match + applied to UW
 *  8. wallet copy respects its symbol argument + no flat 60% win rate
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  MeanReversionStrategy,
  StatArbStrategy,
  CryptoMeanReversionStrategy,
  BreakoutStrategy,
} from '@/lib/strategies/all-strategies'
import { atr } from '@/lib/strategies/tier2/index'
import { isHighAlphaRep, estimateWalletWinRate } from '@/lib/strategies/tier1/index'
import {
  londonHourDecimal,
  inLondonHourWindow,
  isLastBusinessDayOfMonthTz,
} from '@/lib/strategies/cadence-helpers'
import type { PriceBar } from '@/lib/backtester'

function flatBars(n: number, price = 100): PriceBar[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    symbol: 'TEST', open: price, high: price, low: price, close: price, volume: 1000,
  }))
}

function trendBars(n: number, start = 100, step = 1): PriceBar[] {
  return Array.from({ length: n }, (_, i) => {
    const c = start + i * step
    return { date: `d${i}`, symbol: 'TEST', open: c, high: c + 1, low: c - 1, close: c, volume: 1000 }
  })
}

// ── 1. cron fail-closed ───────────────────────────────────────────────────────

describe('cron route auth', () => {
  const origSecret = process.env.CRON_SECRET
  afterEach(() => {
    if (origSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = origSecret
  })

  function fakeReq(auth?: string) {
    return {
      headers: { get: (k: string) => (k === 'authorization' ? auth ?? null : null) },
      nextUrl: new URL('http://localhost/api/cron?task=sync'),
    } as never
  }

  it('FAILS CLOSED: no CRON_SECRET configured → 401 (previously ran unauthenticated)', async () => {
    delete process.env.CRON_SECRET
    const { GET } = await import('@/app/api/cron/route')
    const res = await GET(fakeReq('Bearer anything'))
    expect(res.status).toBe(401)
  })

  it('wrong bearer → 401', async () => {
    process.env.CRON_SECRET = 's3cret'
    const { GET } = await import('@/app/api/cron/route')
    const res = await GET(fakeReq('Bearer wrong'))
    expect(res.status).toBe(401)
  })
})

// ── 2. position monitor key discipline ───────────────────────────────────────

describe('PositionMonitor service-role requirement', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = saved.SUPABASE_SERVICE_ROLE_KEY
    process.env.NEXT_PUBLIC_SUPABASE_URL = saved.NEXT_PUBLIC_SUPABASE_URL
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = saved.NEXT_PUBLIC_SUPABASE_ANON_KEY
  })

  it('throws LOUDLY when only the anon key is available (no silent fallback)', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const { PositionMonitor } = await import('@/lib/workers/position-monitor')
    expect(() => new PositionMonitor()).toThrow(/SERVICE_ROLE/i)
  })
})

// ── 3. stddev guards ─────────────────────────────────────────────────────────

describe('flat-series stddev guards', () => {
  it.each([
    ['MeanReversionStrategy', new MeanReversionStrategy(), 25],
    ['StatArbStrategy', new StatArbStrategy(), 35],
    ['CryptoMeanReversionStrategy', new CryptoMeanReversionStrategy(), 25],
  ] as const)('%s returns null on a perfectly flat series instead of NaN', async (_n, strat, bars) => {
    const signal = await strat.generateSignal('TEST', flatBars(bars))
    expect(signal).toBeNull()
  })
})

// ── 4. London fix DST ────────────────────────────────────────────────────────

describe('London 4pm fix — Europe/London wall clock', () => {
  it('July (BST): 14:30 UTC is 15:30 London — inside the pre-fix window that fixed-UTC code missed', () => {
    const julyAfternoon = new Date('2026-07-03T14:30:00Z')
    expect(londonHourDecimal(julyAfternoon)).toBeCloseTo(15.5, 5)
    expect(inLondonHourWindow(14, 15.92, julyAfternoon)).toBe(true)
    // 15:30 UTC is ALREADY 16:30 London — after the fix; old UTC code traded it
    expect(inLondonHourWindow(14, 15.92, new Date('2026-07-03T15:30:00Z'))).toBe(false)
  })

  it('January (GMT): London == UTC', () => {
    const jan = new Date('2026-01-15T14:30:00Z')
    expect(londonHourDecimal(jan)).toBeCloseTo(14.5, 5)
  })

  it('last business day computed in the LONDON month, never server-local', () => {
    // Friday 2026-07-31 is the last business day of July.
    expect(isLastBusinessDayOfMonthTz('Europe/London', new Date('2026-07-31T12:00:00Z'))).toBe(true)
    // Thursday 2026-07-30 is not.
    expect(isLastBusinessDayOfMonthTz('Europe/London', new Date('2026-07-30T12:00:00Z'))).toBe(false)
    // Saturday never fires.
    expect(isLastBusinessDayOfMonthTz('Europe/London', new Date('2026-08-01T12:00:00Z'))).toBe(false)
  })
})

// ── 5. VCP ATR off-by-one ────────────────────────────────────────────────────

describe('ATR bar-count requirement', () => {
  it('atr(period+1 bars) computes period TRs / period; 14 bars only yields 13 TRs', () => {
    const bars = trendBars(15)
    // Constant true range of 2 (high-low) with 1-step closes: TR = max(2, |h-pc|, |l-pc|) = 2
    const correct = atr(bars, 14)
    expect(correct).toBeCloseTo(2, 5)
    // The OLD call passed 14 bars → 13 TRs / 14 → understated
    const understated = atr(bars.slice(-14), 14)
    expect(understated).toBeLessThan(correct)
    expect(understated).toBeCloseTo(2 * 13 / 14, 5)
  })
})

// ── 6. 52-week breakout ──────────────────────────────────────────────────────

describe('BreakoutStrategy honest 52-week window', () => {
  it('60 daily bars at the high → NO signal (a 60-day high is not a 52-week high)', async () => {
    const strat = new BreakoutStrategy()
    expect(await strat.generateSignal('TEST', trendBars(60))).not.toBeTruthy()
  })

  it('252+ bars closing at the high → signal', async () => {
    const strat = new BreakoutStrategy()
    const bars = trendBars(260)
    const signal = await strat.generateSignal('TEST', bars)
    expect(signal).not.toBeNull()
    expect(signal!.side).toBe('buy')
  })
})

// ── 7. congressional name matching ───────────────────────────────────────────

describe('isHighAlphaRep', () => {
  it('matches full names in either order, with punctuation', () => {
    expect(isHighAlphaRep('Nancy Pelosi')).toBe(true)
    expect(isHighAlphaRep('Pelosi, Nancy')).toBe(true)
    expect(isHighAlphaRep('Rep. Dan Crenshaw (TX)')).toBe(true)
  })

  it('REJECTS bare-substring collisions (any "Taylor" used to match)', () => {
    expect(isHighAlphaRep('Marjorie Taylor Greene')).toBe(false)
    expect(isHighAlphaRep('Taylor Swift')).toBe(false)
    expect(isHighAlphaRep('Van Taylor')).toBe(false)
  })

  it('rejects partial single-token matches and empty input', () => {
    expect(isHighAlphaRep('Nancy Smith')).toBe(false)   // first name alone
    expect(isHighAlphaRep('John Pelosi-Adjacent')).toBe(false)
    expect(isHighAlphaRep(undefined)).toBe(false)
  })
})

// ── 8. wallet copy win rate ──────────────────────────────────────────────────

describe('estimateWalletWinRate', () => {
  it('unknown wallet history → 0.5 (NO assumed edge), never a flat 60%', () => {
    expect(estimateWalletWinRate([])).toBe(0.5)
  })

  it('derives from the wallet own trades, clamped to [0.4, 0.9]', () => {
    const winners = [
      { side: 'YES', price: 0.3 }, { side: 'YES', price: 0.4 }, { side: 'YES', price: 0.2 },
    ]
    expect(estimateWalletWinRate(winners)).toBe(0.9)  // 3/3 clamped
    const losers = [{ side: 'YES', price: 0.8 }, { side: 'YES', price: 0.9 }]
    expect(estimateWalletWinRate(losers)).toBe(0.4)   // 0/2 clamped up to floor
  })
})
