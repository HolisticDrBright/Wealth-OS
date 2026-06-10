/**
 * Tests for lib/tax/carryforward.ts
 * IRS netting rules: ST offsets ST first, then LT; $3k/yr ordinary income
 * offset; remainder carries forward preserving ST/LT character.
 */
import { describe, it, expect } from 'vitest'
import { computeCarryforward, ORDINARY_INCOME_OFFSET_CAP_USD } from '@/lib/tax/carryforward'

describe('computeCarryforward', () => {
  it('returns empty summary for no entries', () => {
    const r = computeCarryforward([])
    expect(r.years).toEqual([])
    expect(r.finalCarryforwardUsd).toBe(0)
  })

  it('ST losses offset ST gains first', () => {
    const r = computeCarryforward([{
      taxYear: 2026,
      shortTermGainsUsd: 5000,
      shortTermLossesUsd: 3000,
      longTermGainsUsd: 0,
      longTermLossesUsd: 0,
    }])
    const y = r.years[0]
    expect(y.usedAgainstGainsUsd).toBe(3000)
    expect(y.netShortTermGainUsd).toBe(2000)
    expect(y.usedAgainstIncomeUsd).toBe(0)
    expect(y.carryforwardUsd).toBe(0)
  })

  it('net ST loss then offsets LT gains (cross-character netting)', () => {
    const r = computeCarryforward([{
      taxYear: 2026,
      shortTermGainsUsd: 1000,
      shortTermLossesUsd: 6000, // net ST loss 5000
      longTermGainsUsd: 4000,
      longTermLossesUsd: 0,
    }])
    const y = r.years[0]
    // 1000 ST loss vs ST gain + 4000 ST loss vs LT gain
    expect(y.usedAgainstGainsUsd).toBe(5000)
    expect(y.netLongTermGainUsd).toBe(0)
    // remaining 1000 ST loss goes against income
    expect(y.usedAgainstIncomeUsd).toBe(1000)
    expect(y.carryforwardUsd).toBe(0)
  })

  it('net LT loss offsets net ST gain', () => {
    const r = computeCarryforward([{
      taxYear: 2026,
      shortTermGainsUsd: 3000,
      shortTermLossesUsd: 0,
      longTermGainsUsd: 0,
      longTermLossesUsd: 2000,
    }])
    const y = r.years[0]
    expect(y.usedAgainstGainsUsd).toBe(2000)
    expect(y.netShortTermGainUsd).toBe(1000)
    expect(y.carryforwardUsd).toBe(0)
  })

  it('caps ordinary income offset at $3,000', () => {
    expect(ORDINARY_INCOME_OFFSET_CAP_USD).toBe(3000)
    const r = computeCarryforward([{
      taxYear: 2026,
      shortTermGainsUsd: 0,
      shortTermLossesUsd: 10000,
      longTermGainsUsd: 0,
      longTermLossesUsd: 0,
    }])
    const y = r.years[0]
    expect(y.usedAgainstIncomeUsd).toBe(3000)
    expect(y.carryforwardUsd).toBe(7000)
    expect(y.carryforwardShortTermUsd).toBe(7000)
    expect(y.carryforwardLongTermUsd).toBe(0)
  })

  it('ST losses are consumed against income before LT losses', () => {
    const r = computeCarryforward([{
      taxYear: 2026,
      shortTermGainsUsd: 0,
      shortTermLossesUsd: 2000,
      longTermGainsUsd: 0,
      longTermLossesUsd: 5000,
    }])
    const y = r.years[0]
    expect(y.usedAgainstIncomeUsd).toBe(3000)
    // 2000 ST fully consumed, 1000 LT consumed → 4000 LT carries
    expect(y.carryforwardShortTermUsd).toBe(0)
    expect(y.carryforwardLongTermUsd).toBe(4000)
  })

  it('carryforward preserves character into subsequent years', () => {
    const r = computeCarryforward([
      {
        taxYear: 2025,
        shortTermGainsUsd: 0,
        shortTermLossesUsd: 8000,
        longTermGainsUsd: 0,
        longTermLossesUsd: 2000,
      },
      {
        taxYear: 2026,
        shortTermGainsUsd: 4000, // ST carryforward should offset this
        shortTermLossesUsd: 0,
        longTermGainsUsd: 0,
        longTermLossesUsd: 0,
      },
    ])
    const y25 = r.years[0]
    // 2025: 3000 vs income (ST first), carry 5000 ST + 2000 LT
    expect(y25.usedAgainstIncomeUsd).toBe(3000)
    expect(y25.carryforwardShortTermUsd).toBe(5000)
    expect(y25.carryforwardLongTermUsd).toBe(2000)

    const y26 = r.years[1]
    // 2026: 5000 ST carry vs 4000 ST gain → 1000 ST loss left;
    // 2000 LT loss; 3000 against income (1000 ST then 2000 LT)
    expect(y26.usedAgainstGainsUsd).toBe(4000)
    expect(y26.netShortTermGainUsd).toBe(0)
    expect(y26.usedAgainstIncomeUsd).toBe(3000)
    expect(y26.carryforwardUsd).toBe(0)
    expect(r.finalCarryforwardUsd).toBe(0)
  })

  it('processes entries in year order regardless of input order', () => {
    const r = computeCarryforward([
      { taxYear: 2026, shortTermGainsUsd: 5000, shortTermLossesUsd: 0, longTermGainsUsd: 0, longTermLossesUsd: 0 },
      { taxYear: 2025, shortTermGainsUsd: 0, shortTermLossesUsd: 9000, longTermGainsUsd: 0, longTermLossesUsd: 0 },
    ])
    expect(r.years.map(y => y.taxYear)).toEqual([2025, 2026])
    // 2025 carries 6000 ST; 2026: 5000 used vs gains, 1000 vs income
    expect(r.years[1].usedAgainstGainsUsd).toBe(5000)
    expect(r.years[1].usedAgainstIncomeUsd).toBe(1000)
    expect(r.finalCarryforwardUsd).toBe(0)
  })
})
