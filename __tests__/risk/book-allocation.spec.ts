/**
 * Book-level risk allocation — unit tests.
 *
 * Invariants under test:
 *  1. The strategy→book map is exhaustive over the registry.
 *  2. Regime multipliers never exceed 1.0 (rotation can only reduce size —
 *     book layer must never weaken upstream risk controls).
 *  3. CRISIS closes every book except convexity.
 *  4. The notional cap math blocks/scales correctly.
 */

import { describe, it, expect } from 'vitest'
import {
  STRATEGY_BOOK, BOOK_NOTIONAL_CAP, REGIME_BOOK_MULTIPLIER, ALL_BOOKS,
  bookFor, regimeBookMultiplier,
} from '@/lib/strategies/strategy-books'
import { STRATEGY_REGISTRY_CONFIG } from '@/lib/strategies/strategy-registry'
import { gateThroughBook, summarizeBookExposures } from '@/lib/risk/book-allocation'

describe('strategy → book map', () => {
  it('covers every strategy in the registry', () => {
    for (const key of Object.keys(STRATEGY_REGISTRY_CONFIG)) {
      expect(ALL_BOOKS, `strategy ${key} has no book`).toContain(STRATEGY_BOOK[key as keyof typeof STRATEGY_BOOK])
    }
  })

  it('unknown keys fall back to event (idiosyncratic default)', () => {
    expect(bookFor('not_a_strategy')).toBe('event')
  })

  it('the classic pairs land in opposing books: carry_trade=carry, fx_trendfollowing=trend, tail_risk_hedging=convexity', () => {
    expect(bookFor('carry_trade')).toBe('carry')
    expect(bookFor('fx_trendfollowing')).toBe('trend')
    expect(bookFor('tail_risk_hedging')).toBe('convexity')
    expect(bookFor('merger_arb')).toBe('event')
    expect(bookFor('triangular_arb')).toBe('arb')
    expect(bookFor('polymarket_base_rate')).toBe('info')
  })
})

describe('regime rotation multipliers', () => {
  it('never exceed 1.0 in any regime — rotation only reduces', () => {
    for (const [regime, table] of Object.entries(REGIME_BOOK_MULTIPLIER)) {
      for (const [book, mult] of Object.entries(table)) {
        expect(mult, `${regime}/${book}`).toBeLessThanOrEqual(1.0)
        expect(mult, `${regime}/${book}`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('CRISIS closes every book except convexity', () => {
    for (const book of ALL_BOOKS) {
      const expected = book === 'convexity' ? 1.0 : 0
      expect(regimeBookMultiplier('CRISIS', book)).toBe(expected)
    }
  })

  it('RISK_OFF cuts carry hardest and keeps trend + convexity whole', () => {
    expect(regimeBookMultiplier('RISK_OFF', 'carry')).toBe(0.5)
    expect(regimeBookMultiplier('RISK_OFF', 'trend')).toBe(1.0)
    expect(regimeBookMultiplier('RISK_OFF', 'convexity')).toBe(1.0)
  })

  it('unknown regime is neutral (no extra restriction)', () => {
    expect(regimeBookMultiplier('SOMETHING_NEW', 'carry')).toBe(1.0)
  })
})

describe('gateThroughBook', () => {
  it('allows full size on an empty portfolio', () => {
    const r = gateThroughBook({
      strategyKey: 'carry_trade', proposedNotionalUsd: 500,
      regime: 'NEUTRAL', totalNotionalUsd: 0, bookNotionalUsd: 0,
    })
    expect(r.allowed).toBe(true)
    expect(r.multiplier).toBe(1.0)
  })

  it('blocks a book that is closed in CRISIS', () => {
    const r = gateThroughBook({
      strategyKey: 'carry_trade', proposedNotionalUsd: 500,
      regime: 'CRISIS', totalNotionalUsd: 10_000, bookNotionalUsd: 1_000,
    })
    expect(r.allowed).toBe(false)
    expect(r.multiplier).toBe(0)
  })

  it('lets convexity through in CRISIS', () => {
    const r = gateThroughBook({
      strategyKey: 'tail_risk_hedging', proposedNotionalUsd: 500,
      regime: 'CRISIS', totalNotionalUsd: 10_000, bookNotionalUsd: 0,
    })
    expect(r.allowed).toBe(true)
    expect(r.multiplier).toBe(1.0)
  })

  it('halves carry size in RISK_OFF', () => {
    const r = gateThroughBook({
      strategyKey: 'options_wheel', proposedNotionalUsd: 1000,
      regime: 'RISK_OFF', totalNotionalUsd: 10_000, bookNotionalUsd: 0,
    })
    expect(r.allowed).toBe(true)
    expect(r.multiplier).toBe(0.5)
  })

  it('blocks when the book is at its cap', () => {
    // carry cap = 30%; book already holds 30% of 10k
    const r = gateThroughBook({
      strategyKey: 'carry_trade', proposedNotionalUsd: 1000,
      regime: 'NEUTRAL', totalNotionalUsd: 10_000, bookNotionalUsd: 3_000,
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/at cap/)
  })

  it('scales down to fit when the proposal would breach the cap', () => {
    // carry cap 30%: total 10k, book 2.5k. Room x: (0.3*10000-2500)/0.7 = 714
    const r = gateThroughBook({
      strategyKey: 'carry_trade', proposedNotionalUsd: 1000,
      regime: 'NEUTRAL', totalNotionalUsd: 10_000, bookNotionalUsd: 2_500,
    })
    expect(r.allowed).toBe(true)
    expect(r.multiplier).toBeGreaterThan(0.6)
    expect(r.multiplier).toBeLessThan(0.8)
    // Verify the scaled position actually fits under the cap
    const x = 1000 * r.multiplier
    expect((2_500 + x) / (10_000 + x)).toBeLessThanOrEqual(0.30 + 1e-9)
  })

  it('passes full size when there is ample room', () => {
    const r = gateThroughBook({
      strategyKey: 'pead', proposedNotionalUsd: 500,
      regime: 'NEUTRAL', totalNotionalUsd: 50_000, bookNotionalUsd: 1_000,
    })
    expect(r.allowed).toBe(true)
    expect(r.multiplier).toBe(1.0)
    expect(r.reason).toBeNull()
  })
})

describe('summarizeBookExposures', () => {
  it('computes shares and utilization per book', () => {
    const byBook = { carry: 3000, trend: 5000, event: 2000, arb: 0, info: 0, convexity: 0 }
    const rows = summarizeBookExposures(10_000, byBook as Record<string, number> as never)
    const carry = rows.find(r => r.book === 'carry')!
    expect(carry.share).toBeCloseTo(0.3)
    expect(carry.utilization).toBeCloseTo(0.3 / BOOK_NOTIONAL_CAP.carry)
  })

  it('handles an empty portfolio without NaN', () => {
    const byBook = Object.fromEntries(ALL_BOOKS.map(b => [b, 0]))
    const rows = summarizeBookExposures(0, byBook as never)
    for (const r of rows) {
      expect(Number.isFinite(r.share)).toBe(true)
      expect(Number.isFinite(r.utilization)).toBe(true)
    }
  })
})
