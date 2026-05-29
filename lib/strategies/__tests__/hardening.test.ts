import { describe, it, expect } from 'vitest'
import { empiricalKelly } from '../empirical-kelly'
import { isPolySymbol, fetchPolymarketPrice } from '../../paper-trading/polymarket-price-feed'
import { STRATEGY_REGISTRY_CONFIG } from '../strategy-registry'

// ─── empiricalKelly tests ──────────────────────────────────────────────────────

describe('empiricalKelly', () => {
  it('blocks stub maturity (fraction=0, blocked=true)', () => {
    const result = empiricalKelly({ kellyFraction: 0.25, maturityStatus: 'stub' })
    expect(result.fraction).toBe(0)
    expect(result.blocked).toBe(true)
  })

  it('blocks retired maturity (fraction=0, blocked=true)', () => {
    const result = empiricalKelly({ kellyFraction: 0.25, maturityStatus: 'retired' })
    expect(result.fraction).toBe(0)
    expect(result.blocked).toBe(true)
  })

  it('blocks live_disabled maturity (fraction=0, blocked=true)', () => {
    const result = empiricalKelly({ kellyFraction: 0.25, maturityStatus: 'live_disabled' })
    expect(result.fraction).toBe(0)
    expect(result.blocked).toBe(true)
  })

  it('applies 50% haircut for paper_trading maturity (no brier, no correlation)', () => {
    const result = empiricalKelly({ kellyFraction: 0.20, maturityStatus: 'paper_trading' })
    expect(result.blocked).toBe(false)
    expect(result.fraction).toBeCloseTo(0.10, 5) // 0.20 * 0.5 = 0.10
  })

  it('returns reduced fraction for live_candidate with good Brier score', () => {
    // live_candidate mult=0.75, brierScore=0.05 → brierMult=max(0.5, 1 - 0.05*2)=0.9
    // fraction = 0.20 * 0.75 * 0.9 = 0.135
    const result = empiricalKelly({
      kellyFraction: 0.20,
      maturityStatus: 'live_candidate',
      brierScore: 0.05,
    })
    expect(result.blocked).toBe(false)
    expect(result.fraction).toBeCloseTo(0.135, 5)
  })

  it('applies 90% haircut for backtest_ready maturity', () => {
    // backtest_ready mult=0.1, fraction = 0.20 * 0.1 = 0.02
    const result = empiricalKelly({ kellyFraction: 0.20, maturityStatus: 'backtest_ready' })
    expect(result.blocked).toBe(false)
    expect(result.fraction).toBeCloseTo(0.02, 5)
  })

  it('applies correlation penalty correctly', () => {
    // paper_trading=0.5, corrPenalty=0.5 → corrMult=0.5
    // fraction = 0.20 * 0.5 * 1.0 * 0.5 = 0.05
    const result = empiricalKelly({
      kellyFraction: 0.20,
      maturityStatus: 'paper_trading',
      correlationPenalty: 0.5,
    })
    expect(result.blocked).toBe(false)
    expect(result.fraction).toBeCloseTo(0.05, 5)
  })

  it('clamps fraction to 0 when correlation penalty is 1', () => {
    const result = empiricalKelly({
      kellyFraction: 0.20,
      maturityStatus: 'paper_trading',
      correlationPenalty: 1.0,
    })
    expect(result.fraction).toBe(0)
    expect(result.blocked).toBe(false)
  })
})

// ─── polymarket-price-feed tests ──────────────────────────────────────────────

describe('isPolySymbol', () => {
  it('returns true for POLY: prefixed symbols', () => {
    expect(isPolySymbol('POLY:abc123')).toBe(true)
  })

  it('returns false for non-POLY symbols', () => {
    expect(isPolySymbol('BTC')).toBe(false)
    expect(isPolySymbol('ETH-USD')).toBe(false)
    expect(isPolySymbol('')).toBe(false)
  })
})

describe('fetchPolymarketPrice', () => {
  it('returns null when META_POLY_BASE_URL is not set', async () => {
    const original = process.env.META_POLY_BASE_URL
    delete process.env.META_POLY_BASE_URL
    const result = await fetchPolymarketPrice('POLY:someConditionId')
    expect(result).toBeNull()
    if (original !== undefined) process.env.META_POLY_BASE_URL = original
  })

  it('returns null for non-POLY symbol', async () => {
    const result = await fetchPolymarketPrice('BTC')
    expect(result).toBeNull()
  })
})

// ─── strategy registry maturity tests ────────────────────────────────────────

describe('STRATEGY_REGISTRY_CONFIG maturity', () => {
  it('all StrategyKey entries in STRATEGY_REGISTRY_CONFIG have a maturityStatus defined', () => {
    const entries = Object.entries(STRATEGY_REGISTRY_CONFIG)
    // Verify at minimum all the known strategy keys are represented
    expect(entries.length).toBeGreaterThanOrEqual(62)
    for (const [key, config] of entries) {
      expect(
        config.maturityStatus,
        `Strategy ${key} is missing maturityStatus`
      ).toBeDefined()
      expect(typeof config.maturityStatus).toBe('string')
    }
  })

  it('stub strategies have maturityStatus === "stub"', () => {
    const stubs = ['odte_strangle_hedged', 'ibit_vol_skew', 'factor_crowded_trade_fade'] as const
    for (const key of stubs) {
      expect(
        STRATEGY_REGISTRY_CONFIG[key].maturityStatus,
        `Expected ${key} to be stub`
      ).toBe('stub')
    }
  })

  it('known paper_trading strategies have maturityStatus === "paper_trading"', () => {
    const paperTrading = ['vcp_minervini', 'quant_momentum', 'pead', 'options_wheel'] as const
    for (const key of paperTrading) {
      expect(
        STRATEGY_REGISTRY_CONFIG[key].maturityStatus,
        `Expected ${key} to be paper_trading`
      ).toBe('paper_trading')
    }
  })

  it('known backtest_ready strategies have maturityStatus === "backtest_ready"', () => {
    const backtest = ['activist_13d_insider_cluster', 'vix_term_structure', 'pendle_pt_fixed_yield'] as const
    for (const key of backtest) {
      expect(
        STRATEGY_REGISTRY_CONFIG[key].maturityStatus,
        `Expected ${key} to be backtest_ready`
      ).toBe('backtest_ready')
    }
  })
})
