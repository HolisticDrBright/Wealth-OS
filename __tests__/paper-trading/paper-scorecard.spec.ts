/**
 * Item 9 — paper-trading evidence scorecards: the pure core math that the
 * validation runbook's weekly review reads.
 */

import { describe, it, expect } from 'vitest'
import { computeScorecardCore, recommendMaturity } from '@/lib/paper-trading/scorecard-core'

const t = (i: number, returnPct: number) => ({
  closedAt: `2026-06-${String(i + 1).padStart(2, '0')}T12:00:00Z`,
  returnPct,
})

describe('computeScorecardCore', () => {
  it('empty history → nulls, zero counts', async () => {
    const core = await computeScorecardCore([])
    expect(core.closedTrades).toBe(0)
    expect(core.winRatePct).toBeNull()
    expect(core.expectancyPct).toBeNull()
    expect(core.longestLossStreak).toBe(0)
  })

  it('computes win rate, expectancy, avg win/loss', async () => {
    const core = await computeScorecardCore([
      t(0, 0.02), t(1, -0.01), t(2, 0.04), t(3, -0.03),
    ])
    expect(core.closedTrades).toBe(4)
    expect(core.winRatePct).toBe(50)
    expect(core.expectancyPct).toBeCloseTo(0.5, 5)         // mean = 0.5%
    expect(core.avgWinPct).toBeCloseTo(3, 5)               // (2+4)/2
    expect(core.avgLossPct).toBeCloseTo(-2, 5)             // (-1-3)/2
  })

  it('longest loss streak counts consecutive losers in close order', async () => {
    const core = await computeScorecardCore([
      t(0, 0.01), t(1, -0.01), t(2, -0.02), t(3, -0.01), t(4, 0.03), t(5, -0.01),
    ])
    expect(core.longestLossStreak).toBe(3)
  })

  it('max drawdown from the compounded equity curve', async () => {
    // +10% then -20%: peak 1.10 → trough 0.88 → DD = 20%
    const core = await computeScorecardCore([t(0, 0.10), t(1, -0.20)])
    expect(core.maxDrawdownPct).toBeCloseTo(20, 1)
  })
})

describe('recommendMaturity — thresholds, never discretion', () => {
  const base = {
    closedTrades: 50, winRatePct: 55, expectancyPct: 0.4,
    avgWinPct: 2, avgLossPct: -1.5, maxDrawdownPct: 8, longestLossStreak: 4,
  }

  it('all gates pass → promote', async () => {
    expect(await recommendMaturity(base, true)).toContain('promote to live_candidate')
  })

  it('thin sample → continue paper with the count', async () => {
    const rec = await recommendMaturity({ ...base, closedTrades: 12 }, false)
    expect(rec).toContain('12/30')
  })

  it('negative expectancy → review, never promote', async () => {
    const rec = await recommendMaturity({ ...base, expectancyPct: -0.2 }, false)
    expect(rec).toContain('negative expectancy')
  })

  it('deep drawdown → reduced size', async () => {
    const rec = await recommendMaturity({ ...base, maxDrawdownPct: 22 }, false)
    expect(rec).toContain('drawdown')
  })
})
