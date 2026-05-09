import { describe, it, expect } from 'vitest'
import { computeTrendHealthScore } from '../trend-health-score'

/** Generate an array of `n` closes starting at `start`, each bar increasing by `step`. */
function ascendingCloses(n: number, start = 100, step = 0.5): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step)
}

/** Generate an array of `n` flat closes all equal to `value`. */
function flatCloses(n: number, value = 100): number[] {
  return Array.from({ length: n }, () => value)
}

describe('computeTrendHealthScore', () => {
  it('returns score=0 when fewer than 200 closes', () => {
    const closes = ascendingCloses(150)
    const result = computeTrendHealthScore(closes)
    expect(result.score).toBe(0)
    expect(result.above200Ema).toBe(false)
    expect(result.emaSlope).toBe('flat')
    expect(result.adxProxy).toBe(0)
  })

  it('returns above200Ema=true when last price is above 200 EMA (strong ascending trend)', () => {
    // A long ascending series ensures last price is above 200 EMA
    const closes = ascendingCloses(300, 50, 1)
    const result = computeTrendHealthScore(closes)
    expect(result.above200Ema).toBe(true)
  })

  it('score is between 0 and 100 for various inputs', () => {
    const series = [
      ascendingCloses(250, 100, 0.2),
      flatCloses(220, 100),
      ascendingCloses(300, 200, -0.3), // descending
    ]
    for (const closes of series) {
      const result = computeTrendHealthScore(closes)
      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(100)
    }
  })

  it('a rising trend of 250 ascending closes has score > 50', () => {
    // Strong, consistent uptrend well above any EMA
    const closes = ascendingCloses(250, 100, 1)
    const result = computeTrendHealthScore(closes)
    expect(result.score).toBeGreaterThan(50)
  })
})
