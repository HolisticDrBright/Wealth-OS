/**
 * Tests for lib/tax/replacement.ts
 * Replacement suggestions must never be "substantially identical"
 * (same security, same-issuer share class, or same-issuer ETF).
 */
import { describe, it, expect } from 'vitest'
import { suggestReplacement, isSubstantiallyIdentical } from '@/lib/tax/replacement'

describe('isSubstantiallyIdentical', () => {
  it('same symbol is identical (case-insensitive)', () => {
    expect(isSubstantiallyIdentical('SPY', 'spy')).toBe(true)
  })

  it('share classes of the same issuer are identical', () => {
    expect(isSubstantiallyIdentical('GOOG', 'GOOGL')).toBe(true)
    expect(isSubstantiallyIdentical('BRK.A', 'BRK.B')).toBe(true)
  })

  it('wrapped crypto of the same asset is identical', () => {
    expect(isSubstantiallyIdentical('BTC', 'WBTC')).toBe(true)
    expect(isSubstantiallyIdentical('ETH', 'STETH')).toBe(true)
  })

  it('ETFs from the same issuer are treated as identical (conservative)', () => {
    expect(isSubstantiallyIdentical('VOO', 'VTI')).toBe(true) // both Vanguard
    expect(isSubstantiallyIdentical('SPY', 'SPLG')).toBe(true) // both SSGA
  })

  it('different issuers tracking the same index are NOT identical (common practice)', () => {
    expect(isSubstantiallyIdentical('SPY', 'VOO')).toBe(false)
    expect(isSubstantiallyIdentical('QQQ', 'ONEQ')).toBe(false)
  })

  it('unrelated stocks are not identical', () => {
    expect(isSubstantiallyIdentical('AAPL', 'MSFT')).toBe(false)
  })
})

describe('suggestReplacement', () => {
  it('suggests a different-issuer ETF for index funds', () => {
    expect(suggestReplacement('SPY')).toBe('VOO')
    expect(suggestReplacement('QQQ')).toBe('ONEQ')
  })

  it('suggests a sector peer for single stocks', () => {
    expect(suggestReplacement('NVDA')).toBe('AMD')
  })

  it('never suggests the same symbol or a same-issuer share class', () => {
    for (const sym of ['SPY', 'VOO', 'IVV', 'QQQ', 'ONEQ', 'IWM', 'VTI', 'AAPL', 'MSFT', 'GOOGL', 'META', 'TSLA', 'NVDA', 'AMD', 'BTC', 'ETH', 'SOL', 'AVAX', 'MATIC']) {
      const rep = suggestReplacement(sym)
      if (rep) {
        expect(isSubstantiallyIdentical(sym, rep)).toBe(false)
      }
    }
  })

  it('returns undefined for unknown symbols rather than guessing', () => {
    expect(suggestReplacement('ZZZZ')).toBeUndefined()
  })

  it('is case-insensitive on input', () => {
    expect(suggestReplacement('spy')).toBe('VOO')
  })
})
