/**
 * Tests for lib/stats/binomial-pvalue.ts
 * Verifies suislanchez binomial methodology.
 */
import { describe, it, expect } from 'vitest'
import { binomialPValue, isStatisticallyImprobable } from '@/lib/stats/binomial-pvalue'

describe('binomialPValue', () => {
  it('1. 50/100 coin flip is not statistically improbable (~0.54)', () => {
    const p = binomialPValue(50, 100)
    // P(X >= 50 | p=0.5) should be around 0.5-0.6 -- not extreme
    expect(p).toBeGreaterThan(0.3)
    expect(p).toBeLessThanOrEqual(1.0)
  })

  it('2. 70/100 wins is highly statistically improbable (p < 0.001)', () => {
    const p = binomialPValue(70, 100)
    expect(p).toBeLessThan(0.001)
  })

  it('3. 100/100 wins has near-zero p-value', () => {
    const p = binomialPValue(100, 100)
    expect(p).toBeLessThan(1e-20)
  })

  it('4. edge cases: total=0 returns 1, wins > total returns 0', () => {
    expect(binomialPValue(0, 0)).toBe(1)
    expect(binomialPValue(5, 3)).toBe(0)
    expect(binomialPValue(-1, 10)).toBe(1)
  })

  it('5. small sample uses exact binomial (n*p <= 5)', () => {
    // n=8, p=0.5: np = 4 < 5, use exact
    const p = binomialPValue(7, 8)
    // P(X >= 7 | n=8, p=0.5) = C(8,7)*(0.5^8) + C(8,8)*(0.5^8) = (8+1)/256 = 0.0352
    expect(p).toBeGreaterThan(0.02)
    expect(p).toBeLessThan(0.08)
  })
})

describe('isStatisticallyImprobable', () => {
  it('6. 70/100 with alpha=0.001 returns true', () => {
    expect(isStatisticallyImprobable(70, 100, 0.001)).toBe(true)
  })

  it('7. 55/100 with alpha=0.001 returns false', () => {
    expect(isStatisticallyImprobable(55, 100, 0.001)).toBe(false)
  })
})
