import { describe, it, expect } from 'vitest'
import { detectIdleCash, BENCHMARK_CASH_YIELD_PCT } from '@/lib/savings/cash-sweep'
import type { Asset } from '@/lib/types'

function asset(overrides: Partial<Asset>): Asset {
  return {
    id: 'a1',
    user_id: 'u1',
    name: 'Checking',
    category: 'cash',
    current_value: 10_000,
    ...overrides,
  }
}

describe('detectIdleCash', () => {
  it('flags idle cash with the annual yield gap vs the benchmark', () => {
    const result = detectIdleCash([asset({ id: 'a1', current_value: 10_000 })])
    expect(result.opportunities).toHaveLength(1)
    const opp = result.opportunities[0]
    // 10,000 * (4.2% - 0.05%) = 415/yr
    expect(opp.annualYieldGapUsd).toBeCloseTo(415, 0)
    expect(opp.benchmarkYieldPct).toBe(BENCHMARK_CASH_YIELD_PCT)
    expect(result.totalIdleCash).toBe(10_000)
  })

  it('ignores non-cash assets', () => {
    const result = detectIdleCash([
      asset({ id: 's1', category: 'stock', current_value: 100_000 }),
      asset({ id: 'r1', category: 'real_estate', current_value: 500_000 }),
    ])
    expect(result.opportunities).toHaveLength(0)
    expect(result.totalAnnualGapUsd).toBe(0)
  })

  it('treats labeled high-yield cash as already earning the benchmark', () => {
    const result = detectIdleCash([
      asset({ id: 'h1', name: 'Marcus HYSA', current_value: 50_000 }),
      asset({ id: 'm1', name: 'Fidelity Money Market', current_value: 25_000 }),
      asset({ id: 't1', name: 'Brokerage cash', notes: 'parked in SGOV', current_value: 5_000 }),
    ])
    expect(result.opportunities).toHaveLength(0)
  })

  it('sorts opportunities by dollar impact, largest first', () => {
    const result = detectIdleCash([
      asset({ id: 'small', name: 'Petty cash', current_value: 2_000 }),
      asset({ id: 'big', name: 'Checking', current_value: 80_000 }),
      asset({ id: 'mid', name: 'Savings', current_value: 20_000 }),
    ])
    expect(result.opportunities.map(o => o.assetId)).toEqual(['big', 'mid', 'small'])
  })

  it('respects a custom benchmark yield', () => {
    const result = detectIdleCash([asset({ current_value: 10_000 })], {
      benchmarkYieldPct: 5,
    })
    expect(result.opportunities[0].annualYieldGapUsd).toBeCloseTo(495, 0)
  })

  it('skips zero and negative balances', () => {
    const result = detectIdleCash([
      asset({ id: 'z', current_value: 0 }),
      asset({ id: 'n', current_value: -100 }),
    ])
    expect(result.opportunities).toHaveLength(0)
  })
})
