/**
 * Promotion gates — unit tests.
 *
 * The gates make the maturity ladder mean something: every bar must be
 * evidence-backed, "ready" requires ALL criteria evaluable AND passing, and
 * the shadow check catches gates that destroy alpha.
 */

import { describe, it, expect } from 'vitest'
import {
  evaluatePaperToLive, evaluateBacktestToPaper,
  type PaperTradeStats, type ShadowComparison,
} from '@/lib/strategies/promotion-gates'

function goodStats(overrides: Partial<PaperTradeStats> = {}): PaperTradeStats {
  return {
    closedTrades: 40,
    avgReturnPct: 0.02,       // +2% per trade — clears stock costs easily
    maxDrawdownPct: 0.08,
    assetClass: 'stocks',
    ...overrides,
  }
}

function goodShadow(overrides: Partial<ShadowComparison> = {}): ShadowComparison {
  return { shadowAvgReturnPct: -0.01, closedShadowTrades: 12, ...overrides }
}

describe('evaluatePaperToLive', () => {
  it('passes a strategy with strong evidence on every axis', () => {
    const r = evaluatePaperToLive('pead', goodStats(), 0.15, goodShadow())
    expect(r.ready).toBe(true)
    expect(r.criteria.every(c => c.pass)).toBe(true)
    expect(r.nextStatus).toBe('live_candidate')
  })

  it('fails on sample size below 30 closed trades', () => {
    const r = evaluatePaperToLive('pead', goodStats({ closedTrades: 12 }), 0.15, goodShadow())
    expect(r.ready).toBe(false)
    expect(r.criteria.find(c => c.name === 'Sample size')!.pass).toBe(false)
  })

  it('fails on negative net expectancy after costs', () => {
    // +3 bps gross per trade on stocks (8 bps round trip) → negative net
    const r = evaluatePaperToLive('pead', goodStats({ avgReturnPct: 0.0003 }), 0.15, goodShadow())
    expect(r.ready).toBe(false)
    expect(r.criteria.find(c => c.name === 'Net expectancy')!.pass).toBe(false)
  })

  it('a polymarket strategy needs a much bigger gross edge to clear costs', () => {
    // +1% per trade clears stocks but not polymarket's ~300 bps round trip
    const stocks = evaluatePaperToLive('pead', goodStats({ avgReturnPct: 0.01 }), 0.15, goodShadow())
    const poly = evaluatePaperToLive('polymarket_base_rate',
      goodStats({ avgReturnPct: 0.01, assetClass: 'polymarket' }), 0.15, goodShadow())
    expect(stocks.criteria.find(c => c.name === 'Net expectancy')!.pass).toBe(true)
    expect(poly.criteria.find(c => c.name === 'Net expectancy')!.pass).toBe(false)
  })

  it('fails on poor calibration (Brier ≥ 0.22)', () => {
    const r = evaluatePaperToLive('pead', goodStats(), 0.30, goodShadow())
    expect(r.ready).toBe(false)
    expect(r.criteria.find(c => c.name === 'Calibration')!.pass).toBe(false)
  })

  it('fails on excessive drawdown', () => {
    const r = evaluatePaperToLive('pead', goodStats({ maxDrawdownPct: 0.22 }), 0.15, goodShadow())
    expect(r.ready).toBe(false)
    expect(r.criteria.find(c => c.name === 'Drawdown')!.pass).toBe(false)
  })

  it('fails the shadow check when rejected trades beat accepted by a wide margin', () => {
    // Shadow +4%/trade vs real +2%/trade → gates are destroying alpha
    const r = evaluatePaperToLive('pead', goodStats(), 0.15,
      goodShadow({ shadowAvgReturnPct: 0.04 }))
    expect(r.ready).toBe(false)
    const shadowCrit = r.criteria.find(c => c.name === 'Shadow check')!
    expect(shadowCrit.pass).toBe(false)
    expect(shadowCrit.actual).toMatch(/rejected beat accepted/)
  })

  it('is not ready when evidence is missing, even if nothing failed', () => {
    // Zero trades: several criteria are unevaluable → ready must be false
    const r = evaluatePaperToLive('pead',
      goodStats({ closedTrades: 0, avgReturnPct: null, maxDrawdownPct: null }),
      null,
      { shadowAvgReturnPct: null, closedShadowTrades: 0 })
    expect(r.ready).toBe(false)
    expect(r.criteria.some(c => !c.evaluable)).toBe(true)
  })
})

describe('evaluateBacktestToPaper', () => {
  it('passes with robust walk-forward and positive OOS return', () => {
    const r = evaluateBacktestToPaper('vix_term_structure', { robustnessRatio: 0.7, oosTotalReturnPct: 4.2 })
    expect(r.ready).toBe(true)
  })

  it('fails when out-of-sample Sharpe collapses vs in-sample (overfit)', () => {
    const r = evaluateBacktestToPaper('vix_term_structure', { robustnessRatio: 0.2, oosTotalReturnPct: 4.2 })
    expect(r.ready).toBe(false)
  })

  it('is not ready without a walk-forward run recorded', () => {
    const r = evaluateBacktestToPaper('vix_term_structure', { robustnessRatio: null, oosTotalReturnPct: null })
    expect(r.ready).toBe(false)
    expect(r.criteria.every(c => !c.evaluable)).toBe(true)
  })
})
