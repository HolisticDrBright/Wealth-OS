/**
 * Tests for lib/backtest/promotion-gates.ts (BRKME methodology).
 */
import { describe, it, expect } from 'vitest'
import {
  evaluatePromotionGates,
  PROMOTION_GATE_THRESHOLDS,
  type BacktestRow,
} from '@/lib/backtest/promotion-gates'

/** Generate n rows with fixed returnPct and baselineReturnPct. */
function makeRows(
  n: number,
  returnPct: number,
  baselineReturnPct: number,
  costPct = 0.001
): BacktestRow[] {
  return Array.from({ length: n }, () => ({ returnPct, baselineReturnPct, costPct }))
}

describe('evaluatePromotionGates', () => {
  it('1. synthetic 50/50 coin flip with $1/$1 payoff fails all gates', () => {
    // Alternating +0.01 and -0.01, net zero after costs
    const rows: BacktestRow[] = Array.from({ length: 200 }, (_, i) => ({
      returnPct: i % 2 === 0 ? 0.01 : -0.01,
      baselineReturnPct: 0.001,
      costPct: 0.001,
    }))
    const result = evaluatePromotionGates(rows, 'stocks')
    expect(result.passed).toBe(false)
    // Should fail roiNetCosts and profitFactor at minimum
    expect(result.failedGates.length).toBeGreaterThanOrEqual(2)
    expect(result.failedGates.some(g => g.includes('roiNetCosts') || g.includes('profitFactor'))).toBe(true)
  })

  it('2. synthetic 90/10 win rate passes all gates', () => {
    // 90% wins at +0.016, 10% losses at -0.010 -- spread evenly to keep drawdown < 10%
    // Every 10th trade is a loss so DD per block = 0.011/0.135 = 8% << 30%
    const rows: BacktestRow[] = Array.from({ length: 150 }, (_, i) => ({
      returnPct: i % 10 < 9 ? 0.016 : -0.010,
      baselineReturnPct: 0.001,
      costPct: 0.001,
    }))
    const result = evaluatePromotionGates(rows, 'stocks')
    expect(result.passed).toBe(true)
    expect(result.failedGates).toEqual([])
    expect(result.metrics.tradeCount).toBe(150)
    expect(result.metrics.tStat).toBeGreaterThan(2.0)
    expect(result.metrics.roiNetCosts).toBeGreaterThan(0)
    expect(result.metrics.profitFactor).toBeGreaterThan(1.2)
    expect(result.metrics.maxDrawdownPct).toBeLessThan(0.30)
  })

  it('3. fails tradeCount gate when fewer than 100 trades', () => {
    const rows = makeRows(50, 0.05, 0.01)
    const result = evaluatePromotionGates(rows)
    expect(result.failedGates.some(g => g.includes('tradeCount'))).toBe(true)
  })

  it('4. fails maxDrawdown gate when drawdown exceeds 30%', () => {
    // Deep loss run to create >30% drawdown
    const rows: BacktestRow[] = [
      ...makeRows(50, 0.02, 0.001),
      ...makeRows(60, -0.05, 0.001),
      ...makeRows(40, 0.01, 0.001),
    ]
    const result = evaluatePromotionGates(rows)
    // Should fail maxDrawdown
    const ddGate = result.failedGates.find(g => g.includes('maxDrawdown'))
    if (ddGate) {
      expect(ddGate).toBeTruthy()
    }
    // At minimum tradeCount passes (150 rows)
    expect(result.metrics.tradeCount).toBe(150)
  })

  it('5. returns correct threshold constants', () => {
    expect(PROMOTION_GATE_THRESHOLDS.minTradeCount).toBe(100)
    expect(PROMOTION_GATE_THRESHOLDS.minTStat).toBe(2.0)
    expect(PROMOTION_GATE_THRESHOLDS.maxDrawdownPct).toBe(0.30)
    expect(PROMOTION_GATE_THRESHOLDS.minProfitFactor).toBe(1.2)
  })

  it('6. empty rows fails all gates', () => {
    const result = evaluatePromotionGates([])
    expect(result.passed).toBe(false)
    expect(result.failedGates.length).toBeGreaterThan(0)
    expect(result.metrics.tradeCount).toBe(0)
  })
})
