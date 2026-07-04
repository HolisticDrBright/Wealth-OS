/**
 * Items 6–8 — expanded scorecards + coverage report:
 *  - zero-trade / all-blocked / open-only / missing-data strategies get
 *    honest cards with the right validation status
 *  - entry/exit slippage summarized separately; material cost impact flagged
 *  - coverage report buckets strategies correctly
 */

import { describe, it, expect } from 'vitest'
import {
  assembleScorecard,
  summarizeSlippage,
  deriveValidationStatus,
  countActivity,
  computeScorecardCore,
  type ScorecardInputs,
} from '@/lib/paper-trading/scorecard-core'
import { buildCoverageReport } from '@/lib/paper-trading/strategy-coverage'

function inputs(overrides: Partial<ScorecardInputs> = {}): ScorecardInputs {
  return {
    strategyKey: 'vcp_minervini',
    assetClass: 'stocks',
    paperEnabled: true,
    closedTrades: [],
    entrySlips: [],
    exitSlips: [],
    skippedDetails: [],
    auditBlocked: 0,
    auditVetoes: 0,
    fillsOpened: 0,
    exitsClosed: 0,
    openPositions: 0,
    lastRunAt: null,
    lastTradeAt: null,
    rollingBrier: null,
    shadowAvgReturnPct: null,
    closedShadowTrades: 0,
    ...overrides,
  }
}

describe('scorecards for inactive strategies (item 6)', () => {
  it('zero activity → no_activity card, never dropped', () => {
    const card = assembleScorecard(inputs())
    expect(card.validationStatus).toBe('no_activity')
    expect(card.closedTrades).toBe(0)
    expect(card.winRatePct).toBeNull()
    expect(card.maturityRecommendation).toContain('no evidence yet')
    expect(card.promotion.ready).toBe(false)
  })

  it('all detections blocked by risk → blocked_only with counts', () => {
    const card = assembleScorecard(inputs({
      skippedDetails: [
        { strategyKey: 'vcp_minervini', outcome: 'riskBlocked' },
        { strategyKey: 'vcp_minervini', outcome: 'riskBlocked' },
        { strategyKey: 'vcp_minervini', outcome: 'positionCapBlocked' },
      ],
      auditBlocked: 2,
      auditVetoes: 2,
    }))
    expect(card.validationStatus).toBe('blocked_only')
    expect(card.opportunitiesDetected).toBe(3)
    expect(card.blockedCount).toBe(5)      // 3 run-detail + 2 audit
    expect(card.riskVetoCount).toBe(5)     // 3 risk outcomes + 2 audit vetoes
  })

  it('missing market data dominates → missing_data', () => {
    const card = assembleScorecard(inputs({
      skippedDetails: [
        { strategyKey: 'x', outcome: 'missing_price' },
        { strategyKey: 'x', outcome: 'missingPrice' },
      ],
    }))
    expect(card.validationStatus).toBe('missing_data')
    expect(card.dataMissingCount).toBe(2)
  })

  it('open positions but nothing closed → open_only', () => {
    const card = assembleScorecard(inputs({ fillsOpened: 2, openPositions: 2 }))
    expect(card.validationStatus).toBe('open_only')
    expect(card.paperFillsOpened).toBe(2)
  })

  it('closed trades below 30 → collecting; at 30 → review_ready', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({
      closedAt: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T12:00:00Z`,
      returnPct: 0.01,
    }))
    expect(assembleScorecard(inputs({ closedTrades: mk(5) })).validationStatus).toBe('collecting')
    const ready = assembleScorecard(inputs({ closedTrades: mk(30) }))
    expect(['review_ready', 'promotion_ready']).toContain(ready.validationStatus)
  })
})

describe('slippage transparency (item 8)', () => {
  it('entry and exit slippage summarized separately', () => {
    const s = summarizeSlippage({ entrySlips: [4, 6], exitSlips: [10], netExpectancyPct: 1.0 })
    expect(s.entrySlippageBps).toBe(5)
    expect(s.exitSlippageBps).toBe(10)
    expect(s.modeledRoundTripCostPct).toBeCloseTo(0.15, 5)
    expect(s.grossExpectancyPct).toBeCloseTo(1.15, 5)
    expect(s.materialCostImpact).toBe(false)
  })

  it('flags material cost impact when slippage flips the expectancy sign', () => {
    const s = summarizeSlippage({ entrySlips: [30], exitSlips: [30], netExpectancyPct: -0.1 })
    expect(s.grossExpectancyPct).toBeCloseTo(0.5, 5)
    expect(s.materialCostImpact).toBe(true)
  })

  it('flags when modeled cost eats more than half the gross edge', () => {
    const s = summarizeSlippage({ entrySlips: [20], exitSlips: [20], netExpectancyPct: 0.3 })
    // gross 0.7, cost 0.4 > 0.35 → material
    expect(s.materialCostImpact).toBe(true)
  })

  it('no fills → all nulls, no fabricated numbers', () => {
    const s = summarizeSlippage({ entrySlips: [], exitSlips: [], netExpectancyPct: null })
    expect(s.entrySlippageBps).toBeNull()
    expect(s.exitSlippageBps).toBeNull()
    expect(s.grossExpectancyPct).toBeNull()
    expect(s.materialCostImpact).toBe(false)
  })
})

describe('activity counters', () => {
  it('opportunities detected = fills + recorded skips (lower bound)', () => {
    const a = countActivity({
      skippedDetails: [
        { strategyKey: 'x', outcome: 'already_open' },
        { strategyKey: 'x', outcome: 'missing_price' },
      ],
      auditBlocked: 1, auditVetoes: 0,
      fillsOpened: 3, exitsClosed: 2, openPositions: 1,
      lastRunAt: '2026-07-04T00:00:00Z', lastTradeAt: '2026-07-03T00:00:00Z',
    })
    expect(a.opportunitiesDetected).toBe(5)
    expect(a.dataMissingCount).toBe(1)
    expect(a.lastRunAt).toBe('2026-07-04T00:00:00Z')
  })
})

describe('coverage report (item 7)', () => {
  const cards = [
    assembleScorecard(inputs({ strategyKey: 'silent_strat' })),
    assembleScorecard(inputs({
      strategyKey: 'blocked_strat',
      skippedDetails: [{ strategyKey: 'blocked_strat', outcome: 'riskBlocked' }],
    })),
    assembleScorecard(inputs({
      strategyKey: 'data_strat',
      skippedDetails: [{ strategyKey: 'data_strat', outcome: 'missing_price' }],
    })),
    assembleScorecard(inputs({
      strategyKey: 'trading_strat',
      fillsOpened: 4,
      exitsClosed: 2,
      closedTrades: [
        { closedAt: '2026-06-01T00:00:00Z', returnPct: 0.02 },
        { closedAt: '2026-06-02T00:00:00Z', returnPct: -0.01 },
      ],
    })),
  ]

  it('buckets every strategy correctly', () => {
    const report = buildCoverageReport(cards)
    expect(report.totalCount).toBe(4)
    expect(report.enabledCount).toBe(4)
    expect(report.silent.map(e => e.strategyKey)).toEqual(['silent_strat'])
    expect(report.blockedByRisk.map(e => e.strategyKey)).toEqual(['blocked_strat'])
    expect(report.blockedByMissingData.map(e => e.strategyKey)).toEqual(['data_strat'])
    expect(report.trading.map(e => e.strategyKey)).toEqual(['trading_strat'])
    expect(report.neverTraded.map(e => e.strategyKey).sort())
      .toEqual(['blocked_strat', 'data_strat', 'silent_strat'])
    expect(report.reviewReady).toHaveLength(0)
  })

  it('computeScorecardCore still handles the trading strategy', () => {
    const core = computeScorecardCore([
      { closedAt: '2026-06-01T00:00:00Z', returnPct: 0.02 },
      { closedAt: '2026-06-02T00:00:00Z', returnPct: -0.01 },
    ])
    expect(core.closedTrades).toBe(2)
    expect(core.winRatePct).toBe(50)
  })
})
