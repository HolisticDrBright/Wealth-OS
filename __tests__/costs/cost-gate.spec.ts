/**
 * Cost gate on entries — edgeClearsCosts() existed in transaction-costs.ts but
 * was never called before entry. Every entry must now clear 2× the venue
 * round-trip cost or be rejected with reason `edge_below_cost_floor`.
 *
 * Venue round trips (fee + half-spread, ×2):
 *   stocks (alpaca)        8 bps → needs ≥  16 bps
 *   crypto (coinbase/kraken) 62 bps → needs ≥ 124 bps
 *   forex (oanda)           6 bps → needs ≥  12 bps
 *   polymarket            300 bps → needs ≥ 600 bps
 */

import { describe, it, expect } from 'vitest'
import { edgeClearsCosts, roundTripCostBps } from '@/lib/costs/transaction-costs'
import { BasePipelineStrategy } from '@/lib/strategies/BasePipelineStrategy'
import type { Opportunity } from '@/lib/strategies/pipeline-types'
import type { AssetClass, StrategyKey } from '@/lib/strategies/strategy-registry'

function makeOpp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'opp-1',
    strategyKey: 'pead' as StrategyKey,
    symbol: 'TEST',
    direction: 'long',
    assetClass: 'stocks',
    strength: 0.8,
    expectedReturn: 0.05,
    metadata: {},
    detectedAt: new Date().toISOString(),
    ...overrides,
  }
}

class TestStrategy extends BasePipelineStrategy {
  readonly key = 'pead' as StrategyKey
  readonly displayName = 'Test'
  readonly assetClass: AssetClass = 'stocks'
}

describe('edgeClearsCosts per-venue thresholds', () => {
  it('alpaca (stocks): 8 bps round trip → 0.15% edge fails, 0.20% passes', () => {
    expect(roundTripCostBps('stocks')).toBe(8)
    expect(edgeClearsCosts(0.0015, 'stocks').clears).toBe(false)
    expect(edgeClearsCosts(0.0020, 'stocks').clears).toBe(true)
  })

  it('coinbase/kraken (crypto): 62 bps round trip → 1.2% fails, 1.3% passes', () => {
    expect(roundTripCostBps('crypto')).toBe(62)
    expect(edgeClearsCosts(0.012, 'crypto').clears).toBe(false)
    expect(edgeClearsCosts(0.013, 'crypto').clears).toBe(true)
  })

  it('oanda (forex): 6 bps round trip → 0.10% fails, 0.15% passes', () => {
    expect(roundTripCostBps('forex')).toBe(6)
    expect(edgeClearsCosts(0.0010, 'forex').clears).toBe(false)
    expect(edgeClearsCosts(0.0015, 'forex').clears).toBe(true)
  })

  it('polymarket: 300 bps round trip → 4% edge fails, 8% passes', () => {
    expect(roundTripCostBps('polymarket')).toBe(300)
    expect(edgeClearsCosts(0.04, 'polymarket').clears).toBe(false)
    expect(edgeClearsCosts(0.08, 'polymarket').clears).toBe(true)
  })
})

describe('BasePipelineStrategy.runRedTeam cost gate', () => {
  const strat = new TestStrategy()

  it('rejects a polymarket signal with 4% edge (needs ≥ 6%)', async () => {
    const verdict = await strat.runRedTeam(
      makeOpp({ assetClass: 'polymarket', expectedReturn: 0.04, strength: 0.9 })
    )
    expect(verdict.passed).toBe(false)
    expect(verdict.score).toBe(0)
    expect(verdict.reason).toContain('edge_below_cost_floor')
    expect(verdict.reason).toContain('400bps')  // gross
    expect(verdict.reason).toContain('300bps')  // round trip
  })

  it('passes a polymarket signal with 8% edge', async () => {
    const verdict = await strat.runRedTeam(
      makeOpp({ assetClass: 'polymarket', expectedReturn: 0.08, strength: 0.9 })
    )
    expect(verdict.passed).toBe(true)
    expect(verdict.reason).toBeUndefined()
  })

  it('a HIGH-strength signal cannot buy its way past the cost floor', async () => {
    // strength=1.0 used to guarantee a passing composite score
    const verdict = await strat.runRedTeam(
      makeOpp({ assetClass: 'crypto', expectedReturn: 0.005, strength: 1.0 })
    )
    expect(verdict.passed).toBe(false)
    expect(verdict.reason).toContain('edge_below_cost_floor')
  })

  it('short signals are gated on |expectedReturn| too', async () => {
    const fails = await strat.runRedTeam(
      makeOpp({ direction: 'short', assetClass: 'stocks', expectedReturn: -0.0005 })
    )
    expect(fails.passed).toBe(false)
    const passes = await strat.runRedTeam(
      makeOpp({ direction: 'short', assetClass: 'stocks', expectedReturn: -0.05 })
    )
    expect(passes.passed).toBe(true)
  })

  it('stocks: 0.1% edge fails (below 16 bps floor), 5% edge passes', async () => {
    const fails = await strat.runRedTeam(makeOpp({ expectedReturn: 0.001 }))
    expect(fails.passed).toBe(false)
    const passes = await strat.runRedTeam(makeOpp({ expectedReturn: 0.05 }))
    expect(passes.passed).toBe(true)
  })
})
