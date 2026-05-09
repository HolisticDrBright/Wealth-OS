import { describe, it, expect } from 'vitest'
import { detectSRLevels, PriceBar } from '../support-resistance'

/** Create a flat bar with equal high/low/close. */
function flatBar(price: number): PriceBar {
  return { high: price, low: price, close: price }
}

/** Create a bar with explicit high/low/close. */
function bar(high: number, low: number, close: number): PriceBar {
  return { high, low, close }
}

describe('detectSRLevels', () => {
  it('returns empty arrays when fewer than 5 bars', () => {
    const prices = [flatBar(100), flatBar(101), flatBar(102)]
    const result = detectSRLevels(prices)
    expect(result.support).toEqual([])
    expect(result.resistance).toEqual([])
  })

  it('detects a pivot high as resistance', () => {
    // Build 20 bars with one clear pivot high in the middle
    const prices: PriceBar[] = []
    for (let i = 0; i < 20; i++) {
      if (i === 10) {
        // Spike up — clear pivot high
        prices.push(bar(150, 98, 100))
      } else {
        prices.push(bar(105, 95, 100))
      }
    }

    const result = detectSRLevels(prices, 20)
    expect(result.resistance.length).toBeGreaterThan(0)
    // The pivot high should be close to 150
    const highestResistance = result.resistance[0]
    expect(highestResistance.price).toBeCloseTo(150, 0)
  })

  it('detects a pivot low as support', () => {
    // Build 20 bars with one clear pivot low in the middle
    const prices: PriceBar[] = []
    for (let i = 0; i < 20; i++) {
      if (i === 10) {
        // Dip down — clear pivot low
        prices.push(bar(102, 50, 75))
      } else {
        prices.push(bar(105, 95, 100))
      }
    }

    const result = detectSRLevels(prices, 20)
    expect(result.support.length).toBeGreaterThan(0)
    // The pivot low should be close to 50
    const lowestSupport = result.support[0]
    expect(lowestSupport.price).toBeCloseTo(50, 0)
  })

  it('returns at most 3 levels per side', () => {
    // Build 60 bars with many alternating pivot highs and lows
    const prices: PriceBar[] = []
    for (let i = 0; i < 60; i++) {
      if (i % 6 === 3) {
        // Every 6th bar (offset 3): spike high pivot
        prices.push(bar(120 + i * 0.5, 90, 100))
      } else if (i % 6 === 0 && i > 0) {
        // Every 6th bar (offset 0): dip low pivot
        prices.push(bar(105, 70 + i * 0.3, 90))
      } else {
        prices.push(bar(108, 93, 100))
      }
    }

    const result = detectSRLevels(prices, 50)
    expect(result.resistance.length).toBeLessThanOrEqual(3)
    expect(result.support.length).toBeLessThanOrEqual(3)
  })

  it('levels are sorted by strength descending', () => {
    // Build bars with pivots of varying strengths via repeated highs and lows
    const prices: PriceBar[] = []
    for (let i = 0; i < 50; i++) {
      // Create a mix of distinct pivot highs at different levels
      if (i === 5 || i === 7) {
        prices.push(bar(130, 95, 100)) // two touches near 130 → stronger cluster
      } else if (i === 20) {
        prices.push(bar(150, 95, 100)) // one touch at 150 → weaker
      } else {
        prices.push(bar(105, 95, 100))
      }
    }

    const result = detectSRLevels(prices, 50)
    for (let i = 0; i < result.resistance.length - 1; i++) {
      expect(result.resistance[i].strength).toBeGreaterThanOrEqual(
        result.resistance[i + 1].strength
      )
    }
    for (let i = 0; i < result.support.length - 1; i++) {
      expect(result.support[i].strength).toBeGreaterThanOrEqual(
        result.support[i + 1].strength
      )
    }
  })
})
