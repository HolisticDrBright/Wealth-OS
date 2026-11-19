/**
 * Phase 1 — one source of truth for the mix.
 *  - lib/allocation/policy.ts is the only place target allocations come from,
 *  - Core targets never contain crypto,
 *  - the old conflicting defaults are gone and every caller routes through
 *    the policy,
 *  - the rebalance engine measures shares over the classes it targets.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import {
  profileMix, corePercentages, coreFundTargets, fundForAssetClass,
  defaultRebalanceTargets, recommendedPortfolio, planningBuckets,
} from '@/lib/allocation/policy'
import {
  CORE_FUNDS, US_SHARE_OF_STOCKS, PROFILE_MIX, DEFAULT_EXPLORE_CAP_FRACTION,
} from '@/lib/config/product-defaults'
import { computeRebalanceTrades } from '@/lib/rebalance-engine'
import type { Asset } from '@/lib/types'

const PROFILES = ['vault', 'conservative', 'balanced', 'growth', 'speculative']

describe('product defaults (owner inputs)', () => {
  it('Core funds are VTI / VXUS / BND / SGOV with a 70/30 US/international split', () => {
    expect(CORE_FUNDS).toEqual({ usStocks: 'VTI', intlStocks: 'VXUS', bonds: 'BND', cashLike: 'SGOV' })
    expect(US_SHARE_OF_STOCKS).toBe(0.70)
  })

  it('every profile mix sums to 1 and holds no crypto', () => {
    for (const p of PROFILES) {
      const m = PROFILE_MIX[p]
      expect(m.stocks + m.bonds + m.cash).toBeCloseTo(1, 10)
      expect(Object.keys(m).sort()).toEqual(['bonds', 'cash', 'stocks'])
    }
  })
})

describe('profile mix and Core fund targets', () => {
  it('unknown or missing profile falls back to balanced (60/35/5)', () => {
    expect(profileMix(null)).toEqual(PROFILE_MIX.balanced)
    expect(profileMix('nonsense')).toEqual(PROFILE_MIX.balanced)
    expect(corePercentages('balanced')).toEqual({ stocksPct: 60, bondsPct: 35, cashPct: 5 })
  })

  it.each(PROFILES)('%s: four funds, weights sum to 1, stocks split 70/30', (p) => {
    const funds = coreFundTargets(p)
    expect(funds.map(f => f.symbol)).toEqual(['VTI', 'VXUS', 'BND', 'SGOV'])
    expect(funds.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1, 10)
    const us = funds.find(f => f.slot === 'usStocks')!.weight
    const intl = funds.find(f => f.slot === 'intlStocks')!.weight
    expect(us / (us + intl)).toBeCloseTo(0.70, 10)
  })

  it('crypto is never a Core asset class', () => {
    for (const p of PROFILES) {
      expect(coreFundTargets(p).every(f => ['stock', 'bond', 'cash'].includes(f.assetClass))).toBe(true)
      expect(defaultRebalanceTargets(p).map(t => t.asset_class)).not.toContain('crypto')
    }
    expect(fundForAssetClass('crypto')).toBeNull()
  })

  it('Core classes trade through the configured funds', () => {
    expect(fundForAssetClass('stock')).toBe('VTI')
    expect(fundForAssetClass('bond')).toBe('BND')
    expect(fundForAssetClass('cash')).toBe('SGOV')
  })
})

describe('defaultRebalanceTargets', () => {
  it.each(PROFILES)('%s: stock/bond/cash only, summing to 100', (p) => {
    const t = defaultRebalanceTargets(p)
    expect(t.map(x => x.asset_class)).toEqual(['stock', 'bond', 'cash'])
    expect(t.reduce((s, x) => s + x.target_pct, 0)).toBe(100)
  })
})

describe('recommendedPortfolio (whole portfolio)', () => {
  it.each(PROFILES)('%s: Core funds + Explore sum to 100%%, Explore = the cap', (p) => {
    const slices = recommendedPortfolio(p)
    expect(slices.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 0)
    expect(slices.find(x => x.key === 'explore')!.pct).toBe(DEFAULT_EXPLORE_CAP_FRACTION * 100)
  })

  it('a custom Explore share shrinks Core proportionally', () => {
    const slices = recommendedPortfolio('balanced', 0.2)
    expect(slices.find(x => x.key === 'explore')!.pct).toBe(20)
    // balanced US stocks = 0.6 × 0.7 × 0.8 = 33.6%
    expect(slices.find(x => x.key === 'us_stocks')!.pct).toBeCloseTo(33.6, 1)
  })
})

describe('planningBuckets', () => {
  it('Explore bucket uses the policy default cap', () => {
    expect(planningBuckets(100_000)).toEqual({ marketBucketUsd: 90_000, sleeveUsd: 10_000 })
  })
  it('never negative', () => {
    expect(planningBuckets(0)).toEqual({ marketBucketUsd: 0, sleeveUsd: 0 })
  })
})

// ─── Rebalance engine denominator ────────────────────────────────────────────

function asset(category: Asset['category'], current_value: number): Asset {
  return { id: category, user_id: 'u', name: category, category, current_value } as Asset
}

describe('computeRebalanceTrades measures shares over targeted classes', () => {
  it('untargeted crypto does not create buys with no matching sells', () => {
    // $60k stock, $30k bond, $10k cash, plus $25k crypto (Explore, untargeted).
    const assets = [asset('stock', 60_000), asset('bond', 30_000), asset('cash', 10_000), asset('crypto', 25_000)]
    const trades = computeRebalanceTrades(assets, defaultRebalanceTargets('balanced'), 5)
    // Over the $100k Core: 60/30/10 vs 60/35/5 → bond under by 5, cash over by 5.
    const net = trades.reduce((s, t) => s + (t.action === 'buy' ? t.suggested_notional : -t.suggested_notional), 0)
    expect(Math.abs(net)).toBeLessThan(1)
    expect(trades.find(t => t.asset_class === 'stock')).toBeUndefined()
  })

  it('never suggests a crypto trade under policy defaults', () => {
    const assets = [asset('stock', 10_000), asset('crypto', 90_000)]
    const trades = computeRebalanceTrades(assets, defaultRebalanceTargets('growth'), 5)
    expect(trades.map(t => t.asset_class)).not.toContain('crypto')
  })

  it('a user’s OWN targets that include crypto still work', () => {
    const assets = [asset('stock', 50_000), asset('crypto', 50_000)]
    const trades = computeRebalanceTrades(assets, [
      { asset_class: 'stock', target_pct: 80 }, { asset_class: 'crypto', target_pct: 20 },
    ], 5)
    expect(trades.find(t => t.asset_class === 'crypto')!.action).toBe('sell')
    expect(trades.find(t => t.asset_class === 'stock')!.action).toBe('buy')
  })
})

// ─── No other source of truth (source contracts) ─────────────────────────────

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, ...p.split('/')), 'utf8')
function files(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...files(rel))
    else if (/\.tsx?$/.test(name)) out.push(rel)
  }
  return out
}

describe('every allocation routes through the policy', () => {
  const code = [...files('lib'), ...files('app'), ...files('components')]

  it('the old conflicting defaults are gone (no definition, no import, no call)', () => {
    const live = (f: string) => read(f).split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(code.filter(f => /\bDEFAULT_TARGETS\b/.test(live(f)))).toEqual([])
    expect(code.filter(f => /\bcoreAllocationFor\b/.test(live(f)))).toEqual([])
  })

  it('no screen reads the risk_profiles.alloc_* seed as a recommendation', () => {
    const readers = code.filter(f => /\.alloc_(stocks|crypto|options|forex|polymarket|multi_asset)\b/.test(read(f)))
    expect(readers).toEqual([])
  })

  it('callers import the policy', () => {
    for (const f of [
      'lib/explore/cap.ts',
      'lib/workers/rebalance-scan.ts',
      'app/(app)/rebalance/page.tsx',
      'lib/actions/planning.ts',
      'components/portfolio/policy-slices.ts',
    ]) {
      expect(read(f)).toContain("@/lib/allocation/policy")
    }
  })

  it('planning no longer hardcodes the Explore share', () => {
    expect(read('lib/actions/planning.ts')).not.toMatch(/investable \* 0\.1\b/)
  })
})
