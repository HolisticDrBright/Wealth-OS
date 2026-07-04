/**
 * Item 10 — deterministic paper fill model: spread + size-dependent impact,
 * partial fills above the depth cap, rejection when modeled cost is too wide.
 */

import { describe, it, expect } from 'vitest'
import { modelFill, FILL_MODEL } from '@/lib/paper-trading/fill-model'

describe('modelFill', () => {
  it('longs pay up, shorts receive less, neutral still pays the spread', () => {
    const base = { assetClass: 'stocks', price: 100, notionalUsd: 10_000 }
    const long = modelFill({ ...base, direction: 'long' })
    const short = modelFill({ ...base, direction: 'short' })
    const neutral = modelFill({ ...base, direction: 'neutral' })

    expect(long.fillPrice).toBeGreaterThan(100)
    expect(short.fillPrice).toBeLessThan(100)
    expect(neutral.fillPrice).toBeGreaterThan(100)   // entries are never free
    expect(long.status).toBe('filled')
  })

  it('impact grows with order size — bigger orders pay more bps', () => {
    const small = modelFill({ assetClass: 'crypto', price: 100_000, direction: 'long', notionalUsd: 5_000 })
    const large = modelFill({ assetClass: 'crypto', price: 100_000, direction: 'long', notionalUsd: 200_000 })
    expect(large.slippageBps).toBeGreaterThan(small.slippageBps)
  })

  it('partial fill above the depth cap — never fills more than modeled liquidity', () => {
    const cap = FILL_MODEL.polymarket.depthCapUsd
    const fill = modelFill({ assetClass: 'polymarket', price: 0.6, direction: 'long', notionalUsd: cap * 3 })
    expect(fill.status).toBe('partial')
    expect(fill.filledNotionalUsd).toBe(cap)
    expect(fill.reason).toContain('partial fill')
  })

  it('rejects when modeled cost exceeds the threshold instead of filling at fantasy prices', () => {
    // Stocks at the 500k depth cap: impact 7 × (500k/50k) = 70 + 3 spread
    // = 73 bps > 60 bps threshold → rejected, zero filled.
    const fill = modelFill({ assetClass: 'stocks', price: 100, direction: 'long', notionalUsd: 500_000 })
    expect(fill.status).toBe('rejected')
    expect(fill.filledNotionalUsd).toBe(0)
    expect(fill.reason).toContain('rejection threshold')
    expect(fill.slippageBps).toBeGreaterThan(FILL_MODEL.stocks.rejectAboveBps)
  })

  it('deterministic — same inputs, same fill', () => {
    const a = modelFill({ assetClass: 'stocks', price: 250, direction: 'long', notionalUsd: 42_000 })
    const b = modelFill({ assetClass: 'stocks', price: 250, direction: 'long', notionalUsd: 42_000 })
    expect(a).toEqual(b)
  })
})
