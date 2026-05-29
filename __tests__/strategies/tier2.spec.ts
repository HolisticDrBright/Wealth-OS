/**
 * Tier 2 — ConfluenceRegistry tests (T2.4)
 *
 * Validates the four acceptance criteria from the spec:
 *   1. 2 agreeing signals -> consensus multiplier 1.25
 *   2. 3 agreeing signals -> consensus multiplier 1.50
 *   3. 1 disagreeing signal -> multiplier halved (* 0.5)
 *   4. Signals older than freshnessMs (1h) are excluded from consensus
 *
 * Additional tests:
 *   5. Neutral direction strategies excluded from long/short agreement count
 *   6. detectWithConfluence() auto-registers opportunities
 *   7. Same strategy re-register replaces rather than duplicates its signal
 *   8. Mixed consensus (tied long/short) returns direction='mixed'
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ConfluenceRegistry, confluenceRegistry } from '@/lib/strategies/confluence-registry'
import { BasePipelineStrategy } from '@/lib/strategies/BasePipelineStrategy'
import type { Opportunity, OpportunityContext } from '@/lib/strategies/pipeline-types'
import { randomUUID } from 'crypto'

// detectWithConfluence() applies two production gates (time-of-day and
// cross-asset regime) that read the wall clock and hit live network feeds.
// Mock both so the auto-registration behaviour is tested deterministically,
// regardless of when/where the suite runs.
vi.mock('@/lib/cadence/time-of-day-guards', () => ({
  isTimeOfDayAllowed: () => true,
}))
vi.mock('@/lib/regime/cross-asset-regime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/regime/cross-asset-regime')>()
  return {
    ...actual,
    detectRegime: async () => ({
      regime: actual.CrossAssetRegime.NEUTRAL,
      vix: null,
      hyOas: null,
      resolvedAt: Date.now(),
    }),
  }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSignal(
  fromStrategyKey: string,
  direction: 'long' | 'short' | 'neutral',
  strength = 0.7,
  ageMs = 0,
  symbol = 'BTC'
) {
  return {
    fromStrategyKey,
    symbol,
    direction,
    strength,
    timestamp: Date.now() - ageMs,
  }
}

function makeOpp(symbol: string, direction: 'long' | 'short' | 'neutral'): Opportunity {
  return {
    id: randomUUID(),
    strategyKey: 'vcp_minervini',
    symbol,
    direction,
    assetClass: 'stocks',
    strength: 0.6,
    expectedReturn: 0.05,
    metadata: { reasoning: 'test opp' },
    detectedAt: new Date().toISOString(),
  }
}

// ─── Fixture strategy ─────────────────────────────────────────────────────────

class TestStrategy extends BasePipelineStrategy {
  readonly key = 'vcp_minervini' as const
  readonly displayName = 'Test'
  readonly assetClass = 'stocks' as const

  private opps: Opportunity[]
  constructor(opps: Opportunity[] = []) {
    super()
    this.opps = opps
  }
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    return this.opps
  }
}

// ─── ConfluenceRegistry unit tests ───────────────────────────────────────────

describe('ConfluenceRegistry', () => {
  let reg: ConfluenceRegistry

  beforeEach(() => {
    reg = new ConfluenceRegistry()
  })

  it('1. consensus with 2 agreeing long signals -> agreementCount=2 (multiplier 1.25)', () => {
    reg.register(makeSignal('strat_a', 'long'))
    reg.register(makeSignal('strat_b', 'long'))

    const cons = reg.consensus('BTC')
    expect(cons.direction).toBe('long')
    expect(cons.agreementCount).toBe(2)
    expect(cons.disagreementCount).toBe(0)
    // Caller applies: agreementCount >= 2 -> multiplier 1.25
    const multiplier = cons.agreementCount >= 3 ? 1.5 : cons.agreementCount >= 2 ? 1.25 : 1.0
    expect(multiplier).toBe(1.25)
  })

  it('2. consensus with 3 agreeing long signals -> agreementCount=3 (multiplier 1.50)', () => {
    reg.register(makeSignal('strat_a', 'long'))
    reg.register(makeSignal('strat_b', 'long'))
    reg.register(makeSignal('strat_c', 'long'))

    const cons = reg.consensus('BTC')
    expect(cons.direction).toBe('long')
    expect(cons.agreementCount).toBe(3)
    const multiplier = cons.agreementCount >= 3 ? 1.5 : cons.agreementCount >= 2 ? 1.25 : 1.0
    expect(multiplier).toBe(1.5)
  })

  it('3. 1 disagreeing signal -> disagreementCount=1 (multiplier halved)', () => {
    reg.register(makeSignal('strat_a', 'long'))
    reg.register(makeSignal('strat_b', 'long'))
    reg.register(makeSignal('strat_c', 'short'))  // opposes

    const cons = reg.consensus('BTC')
    expect(cons.direction).toBe('long')
    expect(cons.agreementCount).toBe(2)
    expect(cons.disagreementCount).toBe(1)

    let multiplier = cons.agreementCount >= 3 ? 1.5 : cons.agreementCount >= 2 ? 1.25 : 1.0
    if (cons.disagreementCount >= 1) multiplier *= 0.5
    expect(multiplier).toBeCloseTo(0.625)  // 1.25 * 0.5
  })

  it('4. signals older than 1h are excluded from consensus', () => {
    const ONE_HOUR_MS = 60 * 60 * 1_000
    reg.register(makeSignal('strat_a', 'long', 0.8, ONE_HOUR_MS + 1))  // stale
    reg.register(makeSignal('strat_b', 'long', 0.7, ONE_HOUR_MS + 1))  // stale

    const cons = reg.consensus('BTC')
    expect(cons.direction).toBe('none')
    expect(cons.agreementCount).toBe(0)
  })

  it('5. neutral direction does not contribute to long or short agreementCount', () => {
    reg.register(makeSignal('strat_a', 'long'))
    reg.register(makeSignal('strat_b', 'neutral'))

    const cons = reg.consensus('BTC')
    expect(cons.direction).toBe('long')
    expect(cons.agreementCount).toBe(1)
    expect(cons.disagreementCount).toBe(0)
  })

  it('7. re-registering same strategy replaces rather than duplicates its signal', () => {
    reg.register(makeSignal('strat_a', 'long'))
    reg.register(makeSignal('strat_a', 'short'))  // same key, different direction

    const signals = reg.getSignalsForSymbol('BTC')
    expect(signals).toHaveLength(1)
    expect(signals[0].direction).toBe('short')
  })

  it('8. tied long/short signals return direction=mixed', () => {
    reg.register(makeSignal('strat_a', 'long'))
    reg.register(makeSignal('strat_b', 'short'))

    const cons = reg.consensus('BTC')
    expect(cons.direction).toBe('mixed')
  })

  it('returns none when no signals exist for symbol', () => {
    const cons = reg.consensus('UNKNOWN')
    expect(cons.direction).toBe('none')
    expect(cons.agreementCount).toBe(0)
    expect(cons.combinedStrength).toBe(0)
  })
})

// ─── detectWithConfluence integration ────────────────────────────────────────

describe('BasePipelineStrategy.detectWithConfluence()', () => {
  beforeEach(() => confluenceRegistry.clear())
  afterEach(() => confluenceRegistry.clear())

  it('6. auto-registers opportunities into the shared confluenceRegistry', async () => {
    const opp = makeOpp('ETH-PERP', 'long')
    const strat = new TestStrategy([opp])
    const ctx: OpportunityContext = {}

    const result = await strat.detectWithConfluence(ctx)
    expect(result).toHaveLength(1)

    const signals = confluenceRegistry.getSignalsForSymbol('ETH-PERP')
    expect(signals).toHaveLength(1)
    expect(signals[0].fromStrategyKey).toBe('vcp_minervini')
    expect(signals[0].direction).toBe('long')
    expect(signals[0].strength).toBe(0.6)
  })

  it('returns empty array and registers nothing when no opportunities found', async () => {
    const strat = new TestStrategy([])
    const result = await strat.detectWithConfluence({})
    expect(result).toHaveLength(0)
    expect(confluenceRegistry.getSignalsForSymbol('ANYTHING')).toHaveLength(0)
  })
})
