/**
 * Tests for lib/tax/tax-aware-rebalance.ts
 * Tax-cost estimation per lot, tax-efficient sell ordering, and the
 * class-level tax-drag estimate attached to rebalance suggestions.
 */
import { describe, it, expect } from 'vitest'
import {
  estimateTaxCost,
  rankSellCandidates,
  estimateRebalanceTaxDrag,
} from '@/lib/tax/tax-aware-rebalance'
import type { TaxLot } from '@/lib/tax-lots'
import type { Asset } from '@/lib/types'

function lot(overrides: Partial<TaxLot> = {}): TaxLot {
  return {
    id: 'l1',
    symbol: 'AAPL',
    quantity: 10,
    costBasis: 100,
    acquiredDate: '2020-01-01',
    ...overrides,
  }
}

describe('estimateTaxCost', () => {
  it('long-term gain taxed at the LT rate (default 15%)', () => {
    const r = estimateTaxCost(lot({ isLongTerm: true }), 150)
    expect(r.gainLossUsd).toBe(500)
    expect(r.isLongTerm).toBe(true)
    expect(r.taxCostUsd).toBe(75)
    expect(r.rateApplied).toBe(0.15)
  })

  it('short-term gain taxed at the ST rate (default 35%)', () => {
    const recent = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)
    const r = estimateTaxCost(lot({ acquiredDate: recent }), 150)
    expect(r.isLongTerm).toBe(false)
    expect(r.taxCostUsd).toBe(175)
    expect(r.rateApplied).toBe(0.35)
  })

  it('losses produce a negative tax cost (benefit)', () => {
    const r = estimateTaxCost(lot({ isLongTerm: true }), 80)
    expect(r.gainLossUsd).toBe(-200)
    expect(r.taxCostUsd).toBe(-30)
  })

  it('respects custom rates', () => {
    const r = estimateTaxCost(lot({ isLongTerm: true }), 150, 0.4, 0.2)
    expect(r.taxCostUsd).toBe(100)
  })
})

describe('rankSellCandidates', () => {
  it('orders losses first, then long-term gains, then short-term gains', () => {
    const recent = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10)
    const candidates = [
      { lot: lot({ id: 'st-gain', acquiredDate: recent, costBasis: 100 }), currentPrice: 150 },
      { lot: lot({ id: 'lt-gain', isLongTerm: true, costBasis: 100 }), currentPrice: 150 },
      { lot: lot({ id: 'loss', isLongTerm: true, costBasis: 100 }), currentPrice: 50 },
    ]
    const ranked = rankSellCandidates(candidates)
    expect(ranked.map(r => r.lot.id)).toEqual(['loss', 'lt-gain', 'st-gain'])
    expect(ranked.map(r => r.tier)).toEqual([0, 1, 2])
  })

  it('within losses sells the biggest loss first; within gains the smallest gain first', () => {
    const candidates = [
      { lot: lot({ id: 'small-loss', isLongTerm: true, costBasis: 100 }), currentPrice: 95 },
      { lot: lot({ id: 'big-loss', isLongTerm: true, costBasis: 100 }), currentPrice: 50 },
      { lot: lot({ id: 'big-gain', isLongTerm: true, costBasis: 100 }), currentPrice: 300 },
      { lot: lot({ id: 'small-gain', isLongTerm: true, costBasis: 100 }), currentPrice: 110 },
    ]
    const ranked = rankSellCandidates(candidates)
    expect(ranked.map(r => r.lot.id)).toEqual(['big-loss', 'small-loss', 'small-gain', 'big-gain'])
  })
})

describe('estimateRebalanceTaxDrag', () => {
  const oldDate = '2020-01-01'
  const recentDate = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)

  function asset(overrides: Partial<Asset>): Asset {
    return {
      id: 'a1',
      user_id: 'u1',
      name: 'Asset',
      category: 'stock',
      current_value: 10000,
      ...overrides,
    }
  }

  it('returns zero drag when selling nothing or no assets in class', () => {
    expect(estimateRebalanceTaxDrag([], 'stock', 5000).taxDragUsd).toBe(0)
    expect(estimateRebalanceTaxDrag([asset({})], 'stock', 0).taxDragUsd).toBe(0)
  })

  it('estimates LT tax drag selling an appreciated long-term position', () => {
    const assets = [asset({ id: 'a1', purchase_price: 5000, purchase_date: oldDate, current_value: 10000 })]
    // Sell the whole position: 5000 gain * 15% = 750
    const r = estimateRebalanceTaxDrag(assets, 'stock', 10000)
    expect(r.taxDragUsd).toBe(750)
    expect(r.sellsShortTermGains).toBe(false)
  })

  it('flags short-term gains and uses the ST rate', () => {
    const assets = [asset({ id: 'a1', purchase_price: 5000, purchase_date: recentDate, current_value: 10000 })]
    const r = estimateRebalanceTaxDrag(assets, 'stock', 10000)
    expect(r.sellsShortTermGains).toBe(true)
    expect(r.taxDragUsd).toBe(1750) // 5000 * 0.35
  })

  it('sells losses first, reducing drag, and flags the harvest', () => {
    const assets = [
      asset({ id: 'loser', purchase_price: 12000, purchase_date: oldDate, current_value: 8000 }),
      asset({ id: 'winner', purchase_price: 2000, purchase_date: recentDate, current_value: 10000 }),
    ]
    // Selling 8000 should liquidate only the losing lot — no tax drag.
    const r = estimateRebalanceTaxDrag(assets, 'stock', 8000)
    expect(r.taxDragUsd).toBe(0)
    expect(r.harvestsLosses).toBe(true)
    expect(r.sellsShortTermGains).toBe(false)
  })

  it('ignores assets of other classes and never returns negative drag', () => {
    const assets = [
      asset({ id: 'crypto', category: 'crypto', purchase_price: 1000, purchase_date: recentDate, current_value: 9000 }),
      asset({ id: 'loser', purchase_price: 12000, purchase_date: oldDate, current_value: 8000 }),
    ]
    const r = estimateRebalanceTaxDrag(assets, 'stock', 4000)
    expect(r.taxDragUsd).toBe(0) // loss harvest → benefit, floored at 0
    expect(r.harvestsLosses).toBe(true)
  })
})
