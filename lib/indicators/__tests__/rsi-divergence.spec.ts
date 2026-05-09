import { describe, it, expect } from 'vitest'
import { detectBullishDivergence, detectBearishDivergence } from '../rsi-divergence'

/**
 * Helper to build an array of `length` values starting at `start`,
 * incrementing by `step` each bar.
 */
function linspace(start: number, step: number, length: number): number[] {
  return Array.from({ length }, (_, i) => start + i * step)
}

describe('detectBullishDivergence', () => {
  it('returns detected=true when price makes a lower low and RSI makes a higher low', () => {
    // Build 20-bar arrays with clear pivot lows
    // Price: descending trend with two troughs — second trough is lower
    // RSI:   descending trend with two troughs — second trough is HIGHER (bullish div)
    const prices = [
      100, 95, 90, 95, 100, 105, 100, 95, 85, 90,  // first pivot low at index 8 (price=85)
      95,  100, 105, 110, 105, 100, 95, 80, 85, 90   // second pivot low at index 17 (price=80, lower)
    ]
    const rsi = [
      60, 55, 40, 45, 55, 60, 55, 50, 30, 35,  // first RSI pivot low at index 8 (rsi=30)
      40, 50, 55, 60, 55, 50, 45, 35, 40, 45   // second RSI pivot low at index 17 (rsi=35, higher)
    ]

    const result = detectBullishDivergence(prices, rsi, 20)
    expect(result.detected).toBe(true)
  })

  it('returns detected=false when both price and RSI make lower lows (no divergence)', () => {
    // Price: lower lows; RSI: also lower lows — no divergence
    const prices = [
      100, 95, 90, 95, 100, 105, 100, 95, 85, 90,
      95,  100, 105, 110, 105, 100, 95, 80, 85, 90
    ]
    const rsi = [
      60, 55, 40, 45, 55, 60, 55, 50, 30, 35,
      40, 50, 55, 60, 55, 50, 45, 25, 30, 35  // second RSI pivot low = 25 (lower, NOT higher)
    ]

    const result = detectBullishDivergence(prices, rsi, 20)
    expect(result.detected).toBe(false)
  })

  it('returns detected=false when arrays are too short', () => {
    const prices = [100, 95, 90]
    const rsi = [60, 55, 40]

    const result = detectBullishDivergence(prices, rsi, 14)
    expect(result.detected).toBe(false)
    expect(result.pivotOffset).toBe(0)
  })
})

describe('detectBearishDivergence', () => {
  it('returns detected=true when price makes a higher high and RSI makes a lower high', () => {
    // Price: two successive peaks, second is HIGHER
    // RSI:   two successive peaks, second is LOWER (bearish divergence)
    const prices = [
      80, 85, 90, 85, 80, 75, 80, 85, 95, 90,  // first pivot high at index 8 (price=95)
      85, 80, 75, 70, 75, 80, 85, 100, 95, 90   // second pivot high at index 17 (price=100, higher)
    ]
    const rsi = [
      40, 45, 70, 65, 55, 45, 50, 55, 75, 70,  // first RSI pivot high at index 8 (rsi=75)
      65, 55, 45, 40, 45, 50, 55, 65, 60, 55   // second RSI pivot high at index 17 (rsi=65, lower)
    ]

    const result = detectBearishDivergence(prices, rsi, 20)
    expect(result.detected).toBe(true)
  })

  it('returns detected=false when arrays are too short for the lookback', () => {
    const prices = [100, 105, 102]
    const rsi = [50, 60, 55]

    const result = detectBearishDivergence(prices, rsi, 14)
    expect(result.detected).toBe(false)
    expect(result.pivotOffset).toBe(0)
  })
})
