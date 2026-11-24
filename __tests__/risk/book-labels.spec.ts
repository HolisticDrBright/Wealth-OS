/**
 * Phase 5 — strategy book labels.
 *  - new 'speculative' book: cap SPECULATIVE_BOOK_CAP (0.10), regime
 *    multipliers RISK_ON 0.5 / NEUTRAL 0.5 / RISK_OFF 0 / CRISIS 0,
 *  - exactly six moves; nothing else moved,
 *  - convexity holds only real long-vol protection (plus one untouched stub),
 *  - owner decision: a moved strategy counts against BOTH books, so moving
 *    can only tighten its limits.
 */

import { describe, it, expect } from 'vitest'
import {
  STRATEGY_BOOK, ALSO_COUNTS_AGAINST, BOOK_NOTIONAL_CAP, REGIME_BOOK_MULTIPLIER, BOOK_META, ALL_BOOKS,
  bookFor, booksFor, regimeBookMultiplier, type StrategyBook,
} from '@/lib/strategies/strategy-books'
import { STRATEGY_REGISTRY_CONFIG } from '@/lib/strategies/strategy-registry'
import { gateThroughBook, computeBookExposures } from '@/lib/risk/book-allocation'
import { SPECULATIVE_BOOK_CAP, SPECULATIVE_REGIME_MULTIPLIER } from '@/lib/config/product-defaults'

/** The map as it stood before Phase 5 (for "don't move anything else"). */
const BEFORE: Record<string, StrategyBook> = {
  vcp_minervini: 'trend', quant_momentum: 'trend', qvm_multifactor: 'trend', sector_rotation: 'trend',
  fx_trendfollowing: 'trend', session_breakout: 'trend', ict_smc: 'trend', dca_halving: 'trend',
  narrative_rotation: 'trend', onchain_signal: 'trend', memecoin_bondingcurve: 'trend', cot_positioning: 'trend',
  cb_divergence: 'trend',
  options_wheel: 'carry', carry_trade: 'carry', funding_basis_arb: 'carry', funding_basis_arb_hyperliquid: 'carry',
  defi_yield: 'carry', dividend_aristocrat: 'carry', rwa_yield_stack: 'carry', pendle_pt_fixed_yield: 'carry',
  polymarket_theta_decay: 'carry', swap_point_arbitrage: 'carry', airdrop_farming: 'carry',
  polymarket_market_maker: 'carry', odte_strangle_hedged: 'carry', ibit_vol_skew: 'carry',
  tail_risk_hedging: 'convexity', vix_term_structure: 'convexity', jpy_intervention_fade: 'convexity',
  gamma_exposure: 'convexity', liquidation_hunting: 'convexity', factor_crowded_trade_fade: 'convexity',
  pead: 'event', pead_microcap_text: 'event', merger_arb: 'event', spinoff: 'event',
  buyback_announcement_momentum: 'event', activist_13d_insider_cluster: 'event', autopilot_congressional: 'event',
  macro_news_event: 'event', polymarket_event_compression: 'event',
  triangular_arb: 'arb', cex_latency_arb: 'arb', etf_basis_arb: 'arb', lst_basis_arb: 'arb',
  correlation_divergence: 'arb', polymarket_cross_market: 'arb', polymarket_triangle_arb: 'arb',
  cross_platform_sports_arb: 'arb', prediction_market_sportsbook_arb: 'arb', london_4pm_fix_endmonth: 'arb',
  month_end_fix: 'arb',
  polymarket_base_rate: 'info', polymarket_resolution_rules: 'info', polymarket_info_lag: 'info',
  polymarket_narrative_fade: 'info', polymarket_liquidity_pocket: 'info', polymarket_no_trade: 'info',
  polymarket_wallet_copy: 'info', polymarket_crypto_binary_5min: 'info', polymarket_kalshi_weather: 'info',
}

const MOVES: Record<string, StrategyBook> = {
  memecoin_bondingcurve: 'speculative',
  airdrop_farming: 'speculative',
  polymarket_crypto_binary_5min: 'speculative',
  liquidation_hunting: 'event',
  gamma_exposure: 'event',
  jpy_intervention_fade: 'event',
}

describe('the speculative book', () => {
  it(`cap = SPECULATIVE_BOOK_CAP (${SPECULATIVE_BOOK_CAP})`, () => {
    expect(SPECULATIVE_BOOK_CAP).toBe(0.10)
    expect(BOOK_NOTIONAL_CAP.speculative).toBe(0.10)
  })
  it('half size in RISK_ON and NEUTRAL, closed in RISK_OFF and CRISIS (owner decision)', () => {
    expect(SPECULATIVE_REGIME_MULTIPLIER).toEqual({ RISK_ON: 0.5, NEUTRAL: 0.5, RISK_OFF: 0, CRISIS: 0 })
    expect(regimeBookMultiplier('RISK_ON', 'speculative')).toBe(0.5)
    expect(regimeBookMultiplier('NEUTRAL', 'speculative')).toBe(0.5)
    expect(regimeBookMultiplier('RISK_OFF', 'speculative')).toBe(0)
    expect(regimeBookMultiplier('CRISIS', 'speculative')).toBe(0)
  })
  it('is a first-class book everywhere (meta, every regime table, ALL_BOOKS)', () => {
    expect(ALL_BOOKS).toContain('speculative')
    expect(BOOK_META.speculative.label).toBe('Speculative')
    for (const table of Object.values(REGIME_BOOK_MULTIPLIER)) expect(table.speculative).toBeDefined()
  })
})

describe('relabels', () => {
  it.each(Object.entries(MOVES))('%s → %s', (key, book) => {
    expect(bookFor(key)).toBe(book)
  })
  it('nothing else moved', () => {
    for (const [key, before] of Object.entries(BEFORE)) {
      if (key in MOVES) continue
      expect(STRATEGY_BOOK[key as keyof typeof STRATEGY_BOOK], key).toBe(before)
    }
  })
  it('the map still covers every registered strategy, and no strategy was added or dropped', () => {
    expect(new Set(Object.keys(STRATEGY_BOOK))).toEqual(new Set(Object.keys(BEFORE)))
    for (const key of Object.keys(STRATEGY_REGISTRY_CONFIG)) expect(STRATEGY_BOOK).toHaveProperty(key)
  })
  it('convexity holds only tail_risk_hedging and vix_term_structure among strategies that can trade', () => {
    const convexity = Object.entries(STRATEGY_BOOK).filter(([, b]) => b === 'convexity').map(([k]) => k)
    const tradable = convexity.filter(k => STRATEGY_REGISTRY_CONFIG[k as keyof typeof STRATEGY_REGISTRY_CONFIG]?.maturityStatus !== 'stub')
    expect(tradable.sort()).toEqual(['tail_risk_hedging', 'vix_term_structure'])
    // The one stub left in place (brief: move nothing else) can never execute.
    expect(convexity).toContain('factor_crowded_trade_fade')
    expect(STRATEGY_REGISTRY_CONFIG.factor_crowded_trade_fade.maturityStatus).toBe('stub')
  })
  it('no maturity status changed', () => {
    // Phase 5 is labels only — promotion stays a manual registry edit.
    expect(STRATEGY_REGISTRY_CONFIG.memecoin_bondingcurve.maturityStatus).toBe('paper_trading')
    expect(STRATEGY_REGISTRY_CONFIG.vix_term_structure.maturityStatus).toBe('backtest_ready')
    expect(STRATEGY_REGISTRY_CONFIG.jpy_intervention_fade.maturityStatus).toBe('backtest_ready')
  })
})

describe('moved strategies count against BOTH books (owner decision)', () => {
  it('exactly the six moves, each pointing at its old book', () => {
    expect(Object.keys(ALSO_COUNTS_AGAINST).sort()).toEqual(Object.keys(MOVES).sort())
    for (const [key, old] of Object.entries(ALSO_COUNTS_AGAINST)) expect(old).toBe(BEFORE[key])
    expect(booksFor('memecoin_bondingcurve')).toEqual(['speculative', 'trend'])
    expect(booksFor('liquidation_hunting')).toEqual(['event', 'convexity'])
    expect(booksFor('merger_arb')).toEqual(['event'])
  })

  it('a full OLD book blocks the moved strategy even with room in the new one', () => {
    const r = gateThroughBook({
      strategyKey: 'memecoin_bondingcurve', proposedNotionalUsd: 500, regime: 'RISK_ON',
      totalNotionalUsd: 10_000, bookNotionalUsd: 0,
      otherBooks: { trend: { notionalUsd: 3_600, riskUnits: 0 } },   // trend at its 35% cap
    })
    expect(r.allowed).toBe(false)
    expect(r.book).toBe('speculative')
    expect(r.reason).toContain('old trend book')
  })

  it('never allows more than either book alone would (property)', () => {
    const regimes = ['RISK_ON', 'NEUTRAL', 'RISK_OFF', 'CRISIS']
    for (const key of Object.keys(MOVES)) {
      const [primary, old] = booksFor(key)
      for (let i = 0; i < 300; i++) {
        const total = 1 + Math.random() * 40_000
        const inPrimary = Math.random() * total
        const inOld = Math.random() * total
        const regime = regimes[i % 4]
        const both = gateThroughBook({
          strategyKey: key, proposedNotionalUsd: 800, regime, totalNotionalUsd: total, bookNotionalUsd: inPrimary,
          otherBooks: { [old]: { notionalUsd: inOld, riskUnits: 0 } },
        })
        // The same position judged by its new book alone / by its OLD book alone.
        const primaryOnly = singleBook(primary, regime, total, inPrimary, 800)
        const oldOnly = singleBook(old, regime, total, inOld, 800)
        expect(both.multiplier).toBeLessThanOrEqual(Math.min(primaryOnly, oldOnly) + 1e-12)
      }
    }
  })

  it('the move can only tighten: in CRISIS the ex-convexity strategies are now closed', () => {
    for (const key of ['liquidation_hunting', 'gamma_exposure', 'jpy_intervention_fade']) {
      const r = gateThroughBook({ strategyKey: key, proposedNotionalUsd: 500, regime: 'CRISIS', totalNotionalUsd: 0, bookNotionalUsd: 0 })
      expect(r.allowed, key).toBe(false)
    }
  })

  it('exposure is added to both books but counted once in the totals', async () => {
    const rows = [
      { strategy_key: 'memecoin_bondingcurve', symbol: 'PEPE', asset_class: 'crypto', notional_usd: 300 },
      { strategy_key: 'quant_momentum', symbol: 'AAPL', asset_class: 'stocks', notional_usd: 700 },
    ]
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'not']) c[m] = () => c
    c.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res)
    const s = await computeBookExposures({ from: () => c } as never, 'u1', async () => ({ vol: 1, source: 'default', observations: 0 }))
    expect(s.totalNotionalUsd).toBe(1_000)
    expect(s.byBook.speculative).toBe(300)
    expect(s.byBook.trend).toBe(1_000)    // 700 momentum + 300 memecoin (old book)
    expect(s.totalRiskUnits).toBe(1_000)
  })
})

/** Reference: the multiplier ONE book's regime rule + dollar cap allows (pre-Phase-5 rule). */
function singleBook(book: StrategyBook, regime: string, total: number, open: number, proposed: number): number {
  const rm = regimeBookMultiplier(regime, book)
  if (rm <= 0) return 0
  if (total <= 0) return rm
  const cap = BOOK_NOTIONAL_CAP[book]
  const room = (cap * total - open) / (1 - cap)
  const p = proposed * rm
  if (room <= p * 0.1) return 0
  if (room < p) return Math.min(rm, room / proposed)
  return rm
}
