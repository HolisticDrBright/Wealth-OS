/**
 * Corpus consumers (R1) against the 1-month sample fixture: wallet-copy reads
 * live wallet_stats with recertification enforced; Kelly priors come from
 * measured category_bias; uncorpused wallets stay SHADOW-ONLY.
 */

import { describe, it, expect, vi } from 'vitest'
import fixture from '../fixtures/poly-corpus-sample.json'
import { fetchCorpusWalletStats, PolymarketWalletCopyStrategy } from '@/lib/strategies/impl/polymarket/polymarket-wallet-copy'
import { loadCategoryPrior, priceBucketOf, _setPriorCacheForTest } from '@/lib/risk/polymarket-priors'
import type { Opportunity } from '@/lib/strategies/pipeline-types'

const RECENT = new Date(Date.now() - 5 * 86_400_000).toISOString()
const STALE = new Date(Date.now() - 90 * 86_400_000).toISOString()

function supabaseWithWalletStats() {
  const rows = fixture.wallet_stats.map(w => ({
    ...w,
    recertified_at: w.recertified_at === 'RECENT' ? RECENT : STALE,
  }))
  return {
    from: vi.fn(() => {
      const builder: Record<string, unknown> = {}
      let filtered = rows as Array<Record<string, unknown>>
      builder.select = () => builder
      builder.eq = (_c: string, v: string) => { filtered = rows.filter(r => r.wallet === v); return builder }
      builder.maybeSingle = () => Promise.resolve({ data: filtered[0] ?? null, error: null })
      return builder
    }),
  } as never
}

describe('wallet_stats consumption (fixture month)', () => {
  it('recently recertified wallet → REAL stats, strict gate re-enabled', async () => {
    const stats = await fetchCorpusWalletStats(supabaseWithWalletStats(), '0xabc')
    expect(stats).not.toBeNull()
    expect(stats!.winRate).toBeCloseTo(0.62, 10)
    expect(stats!.isEstimated).toBe(false)
    expect(stats!.tradeCount).toBe(84)
  })

  it('stale certification → NOT admitted (falls back to estimates)', async () => {
    expect(await fetchCorpusWalletStats(supabaseWithWalletStats(), '0xdef')).toBeNull()
  })

  it('uncorpused opportunity is vetoed shadow-only by the risk check', async () => {
    const strat = new PolymarketWalletCopyStrategy()
    const opp = {
      id: 'o1', strategyKey: 'polymarket_wallet_copy', symbol: 'POLY:x',
      direction: 'long', assetClass: 'polymarket', strength: 0.5, expectedReturn: 0.1,
      metadata: { corpusBacked: false }, detectedAt: new Date().toISOString(),
    } as Opportunity
    const verdict = await strat.runRiskCheck(opp, 'u1', undefined)
    expect(verdict.veto).toBe(true)
    expect(verdict.reason).toContain('shadow-only')
  })
})

describe('category_bias → Kelly priors', () => {
  it('measured longshot frequency becomes the prior (politics 5c → 3.1%)', async () => {
    _setPriorCacheForTest(fixture.category_bias)
    const prior = await loadCategoryPrior({} as never, 'politics', 0.04)
    expect(prior).toBeCloseTo(0.031, 10)
  })

  it('no corpus row / thin sample → null (never assume an edge)', async () => {
    _setPriorCacheForTest(fixture.category_bias)
    expect(await loadCategoryPrior({} as never, 'weather', 0.04)).toBeNull()
  })

  it('price bucketing clamps to [0.05, 0.95] midpoints', () => {
    expect(priceBucketOf(0.04)).toBe(0.05)
    expect(priceBucketOf(0.52)).toBe(0.55)
    expect(priceBucketOf(0.999)).toBe(0.95)
  })
})
