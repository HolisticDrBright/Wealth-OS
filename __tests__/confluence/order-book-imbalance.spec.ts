/**
 * order-book-imbalance — 3 unit tests
 *
 * Tests:
 *  1. Returns bull signal when bid volume exceeds bullThreshold (Binance path)
 *  2. Returns bear signal when ask volume exceeds bearThreshold (Binance path)
 *  3. Returns neutral when fetch fails (network error)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getOrderBookImbalance } from '@/lib/confluence/order-book-imbalance'

beforeEach(() => {
  vi.unstubAllGlobals()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function makeBinanceDepth(bids: number[], asks: number[]) {
  return {
    lastUpdateId: 1,
    bids: bids.map(qty => ['50000', String(qty)]),
    asks: asks.map(qty => ['50001', String(qty)]),
  }
}

describe('getOrderBookImbalance', () => {
  it('returns bull signal when bid/ask ratio exceeds bullThreshold (Binance)', async () => {
    // bid=200 units, ask=100 units → ratio = 2.0 > 1.8 → bull
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeBinanceDepth(
        Array(10).fill(20),  // 10 bid levels × 20 = 200 total
        Array(10).fill(10),  // 10 ask levels × 10 = 100 total
      )),
    }))

    const verdict = await getOrderBookImbalance('BTC', 'binance', 'long')

    expect(verdict.signal).toBe('bull')
    expect(verdict.ratio).toBeCloseTo(2.0, 1)
    expect(verdict.venue).toBe('binance')
  })

  it('returns bear signal when ask volume dominates (ratio < bearThreshold)', async () => {
    // bid=50 units, ask=100 units → ratio = 0.5 < 0.55 → bear
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeBinanceDepth(
        Array(10).fill(5),   // 10 bid levels × 5 = 50 total
        Array(10).fill(10),  // 10 ask levels × 10 = 100 total
      )),
    }))

    const verdict = await getOrderBookImbalance('BTC', 'binance', 'short')

    expect(verdict.signal).toBe('bear')
    expect(verdict.ratio).toBeCloseTo(0.5, 1)
  })

  it('returns neutral when fetch network error occurs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    const verdict = await getOrderBookImbalance('BTC', 'binance', 'long')

    expect(verdict.signal).toBe('neutral')
    expect(verdict.ratio).toBe(1.0)
    expect(verdict.venue).toBe('binance')
  })
})
