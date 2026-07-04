/**
 * W7 — honest halves finished:
 *  - KB §1 wealth-tier ladder (HNW/VHNW/UHNW) drives the sweep tier cap
 *  - loadCategoryPrior (measured corpus resolution frequencies) feeds the
 *    empirical sizing path for polymarket entries
 */

import { describe, it, expect, vi } from 'vitest'
import { tierCapForInvestable } from '@/lib/advisory/sweep-engine'
import { _setPriorCacheForTest } from '@/lib/risk/polymarket-priors'
import { PolymarketResolutionRulesStrategy } from '@/lib/strategies/impl/polymarket/stubs'
import type { Opportunity } from '@/lib/strategies/pipeline-types'

describe('tierCapForInvestable — full KB §1 ladder', () => {
  const params = {
    sleeve_cap_mass_market: 0.05,
    sleeve_cap_mass_affluent: 0.10,
    sleeve_cap_hnw: 0.10,
    sleeve_cap_vhnw: 0.15,
    sleeve_cap_uhnw: 0.20,
  }

  it('maps each wealth tier to its cap', () => {
    expect(tierCapForInvestable(50_000, params)).toBe(0.05)      // mass market
    expect(tierCapForInvestable(500_000, params)).toBe(0.10)     // mass affluent
    expect(tierCapForInvestable(2_000_000, params)).toBe(0.10)   // HNW
    expect(tierCapForInvestable(10_000_000, params)).toBe(0.15)  // VHNW
    expect(tierCapForInvestable(50_000_000, params)).toBe(0.20)  // UHNW
  })

  it('missing upper-tier params fall back to the nearest LOWER tier — never looser', () => {
    const partial = { sleeve_cap_mass_market: 0.05, sleeve_cap_mass_affluent: 0.10 }
    expect(tierCapForInvestable(10_000_000, partial)).toBe(0.10)
    expect(tierCapForInvestable(50_000_000, partial)).toBe(0.10)
  })
})

describe('loadCategoryPrior wired into the live sizing path', () => {
  function makeSupabase() {
    // Real equity is required to size at all; everything else is empty.
    const tableRows: Record<string, unknown[]> = {
      assets: [{ current_value: 10_000 }],
    }
    const from = vi.fn((table: string) => {
      const rows = tableRows[table] ?? []
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'gte', 'order', 'limit']) chain[m] = vi.fn(() => chain)
      chain.single = vi.fn(async () => ({ data: rows[0] ?? null, error: null }))
      chain.insert = vi.fn(async () => ({ error: null }))
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve)
      return chain
    })
    return { from } as never
  }

  function makeOpp(metadata: Record<string, unknown>): Opportunity {
    return {
      id: 'opp-1', strategyKey: 'polymarket_resolution_rules', symbol: 'POLY:0xabc',
      assetClass: 'polymarket', direction: 'long', expectedReturn: 0.05, strength: 0.8,
      metadata,
    } as never
  }

  it('a measured corpus prior raises the Kelly fraction above the uncalibrated probe', async () => {
    const strat = new PolymarketResolutionRulesStrategy()
    const supabase = makeSupabase()

    // Without a category → uncalibrated probe sizing.
    _setPriorCacheForTest([])
    const withoutPrior = await strat.runRiskCheck(makeOpp({}), 'user-1', supabase)

    // With a well-measured 90%-resolution category at this price bucket.
    _setPriorCacheForTest([
      { category: 'crypto', price_bucket: 0.85, realized_freq: 0.9, n: 500 },
    ])
    const withPrior = await strat.runRiskCheck(
      makeOpp({ category: 'crypto', entryPrice: 0.82 }),
      'user-1',
      supabase
    )

    expect(withPrior.kellyFraction).toBeGreaterThan(withoutPrior.kellyFraction)
  })

  it('an unmeasured category (n < 100) assumes NO edge — probe sizing unchanged', async () => {
    const strat = new PolymarketResolutionRulesStrategy()
    const supabase = makeSupabase()

    _setPriorCacheForTest([])
    const baseline = await strat.runRiskCheck(makeOpp({}), 'user-1', supabase)

    _setPriorCacheForTest([
      { category: 'politics', price_bucket: 0.85, realized_freq: 0.99, n: 12 },
    ])
    const thin = await strat.runRiskCheck(
      makeOpp({ category: 'politics', entryPrice: 0.82 }),
      'user-1',
      supabase
    )

    expect(thin.kellyFraction).toBeCloseTo(baseline.kellyFraction, 10)
  })
})
