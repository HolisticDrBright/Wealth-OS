/**
 * Strategy books — multi-strat portfolio construction layer.
 *
 * Hedge funds don't run strategies as a flat list; they group them into books
 * with offsetting risk profiles and allocate RISK (not capital) across books:
 *
 *   carry      Harvests risk premia — steady gains, sharp correlated losses
 *              in crises. The book that needs the tightest aggregate cap.
 *   convexity  Long-vol / tail protection — bleeds small, pays in crises.
 *              The insurance that lets the carry book exist.
 *   trend      Momentum / trend following — the classic diversifier to carry
 *              ("CTA smile"): profits in sustained risk-off moves.
 *   event      Deal- and event-driven — idiosyncratic outcomes, near-zero
 *              market beta. Sharpe comes from many small independent bets.
 *   arb        Structural arbitrage — market-neutral, highest gross Sharpe,
 *              lowest capacity, most cost-sensitive.
 *   info       Information edges in prediction markets — genuinely
 *              uncorrelated to financial markets, capped by venue risk.
 *   speculative  Lottery tickets (Phase 5): memecoins, airdrop farming,
 *              5-minute crypto binaries. Small cap, half size in good
 *              regimes, closed in bad ones.
 *
 * The map below is exhaustive over StrategyKey (compile-time enforced), so a
 * new strategy cannot be registered without declaring its book.
 *
 * Phase 5 relabels (owner decision: a MOVED strategy counts against BOTH its
 * new book and its old one — see ALSO_COUNTS_AGAINST — so moving it can only
 * tighten its limits, never loosen them).
 */

import type { StrategyKey } from './strategy-registry'
import { SPECULATIVE_BOOK_CAP, SPECULATIVE_REGIME_MULTIPLIER } from '@/lib/config/product-defaults'

export type StrategyBook = 'carry' | 'convexity' | 'trend' | 'event' | 'arb' | 'info' | 'speculative'

export const ALL_BOOKS: StrategyBook[] = ['carry', 'convexity', 'trend', 'event', 'arb', 'info', 'speculative']

export const STRATEGY_BOOK: Record<StrategyKey, StrategyBook> = {
  // ── Trend / momentum ────────────────────────────────────────────────────────
  vcp_minervini:            'trend',
  quant_momentum:           'trend',
  qvm_multifactor:          'trend',     // momentum-tilted multifactor
  sector_rotation:          'trend',
  fx_trendfollowing:        'trend',
  session_breakout:         'trend',
  ict_smc:                  'trend',
  dca_halving:              'trend',     // phase-aware accumulation rides the cycle
  narrative_rotation:       'trend',
  onchain_signal:           'trend',
  cot_positioning:          'trend',
  cb_divergence:            'trend',     // macro divergence rides policy trends

  // ── Carry / short-vol income ────────────────────────────────────────────────
  options_wheel:            'carry',
  carry_trade:              'carry',
  funding_basis_arb:        'carry',
  funding_basis_arb_hyperliquid: 'carry',
  defi_yield:               'carry',
  dividend_aristocrat:      'carry',
  rwa_yield_stack:          'carry',
  pendle_pt_fixed_yield:    'carry',
  polymarket_theta_decay:   'carry',
  swap_point_arbitrage:     'carry',
  polymarket_market_maker:  'carry',     // bid-ask income, short-tail profile
  odte_strangle_hedged:     'carry',     // stub — never executes, classified for completeness
  ibit_vol_skew:            'carry',     // stub — never executes

  // ── Convexity / tail ────────────────────────────────────────────────────────
  // Real long-vol protection only (Phase 5).
  tail_risk_hedging:        'convexity',
  vix_term_structure:       'convexity',
  factor_crowded_trade_fade:'convexity', // stub — never executes; left in place (brief: move nothing else)

  // ── Event-driven ────────────────────────────────────────────────────────────
  pead:                     'event',
  pead_microcap_text:       'event',
  merger_arb:               'event',
  spinoff:                  'event',
  buyback_announcement_momentum: 'event',
  activist_13d_insider_cluster:  'event',
  autopilot_congressional:  'event',
  macro_news_event:         'event',
  polymarket_event_compression:  'event',
  // Phase 5: event / catalyst trades, not insurance — moved from convexity.
  liquidation_hunting:      'event',     // forced-seller cascades are a catalyst, not a hedge
  gamma_exposure:           'event',     // dealer-positioning catalysts
  jpy_intervention_fade:    'event',     // a policy-event fade

  // ── Structural arbitrage ────────────────────────────────────────────────────
  triangular_arb:           'arb',
  cex_latency_arb:          'arb',
  etf_basis_arb:            'arb',
  lst_basis_arb:            'arb',
  correlation_divergence:   'arb',
  polymarket_cross_market:  'arb',
  polymarket_triangle_arb:  'arb',
  cross_platform_sports_arb:'arb',
  prediction_market_sportsbook_arb: 'arb',
  london_4pm_fix_endmonth:  'arb',
  month_end_fix:            'arb',

  // ── Information edge (prediction markets) ───────────────────────────────────
  polymarket_base_rate:     'info',
  polymarket_resolution_rules: 'info',
  polymarket_info_lag:      'info',
  polymarket_narrative_fade:'info',
  polymarket_liquidity_pocket: 'info',
  polymarket_no_trade:      'info',
  polymarket_wallet_copy:   'info',
  polymarket_kalshi_weather:'info',

  // ── Speculative (Phase 5) ───────────────────────────────────────────────────
  memecoin_bondingcurve:    'speculative', // was trend
  airdrop_farming:          'speculative', // was carry
  polymarket_crypto_binary_5min: 'speculative', // was info
}

/**
 * Owner decision (Phase 5): strategies moved to a new book ALSO count against
 * the book they came from. Their exposure is added to both books and a new
 * position must fit both books' caps (dollars and risk) and both books'
 * regime multipliers — the smaller allowed size wins.
 */
export const ALSO_COUNTS_AGAINST: Partial<Record<StrategyKey, StrategyBook>> = {
  memecoin_bondingcurve:         'trend',
  airdrop_farming:               'carry',
  polymarket_crypto_binary_5min: 'info',
  liquidation_hunting:           'convexity',
  gamma_exposure:                'convexity',
  jpy_intervention_fade:         'convexity',
}

export interface BookMeta {
  label: string
  blurb: string
}

export const BOOK_META: Record<StrategyBook, BookMeta> = {
  carry: {
    label: 'Carry / Income',
    blurb: 'Harvests risk premia. Steady gains; losses correlate in crises — capped tightest.',
  },
  convexity: {
    label: 'Convexity / Tail',
    blurb: 'Long-vol protection. Bleeds small, pays in crises. Insures the carry book.',
  },
  trend: {
    label: 'Trend / Momentum',
    blurb: 'Rides sustained moves. The classic diversifier to carry — crisis alpha.',
  },
  event: {
    label: 'Event-Driven',
    blurb: 'Deal- and catalyst-specific outcomes with near-zero market beta.',
  },
  arb: {
    label: 'Structural Arb',
    blurb: 'Market-neutral spread capture. High gross Sharpe, low capacity, cost-sensitive.',
  },
  info: {
    label: 'Information Edge',
    blurb: 'Prediction-market edges, uncorrelated to financial markets. Venue-capped.',
  },
  speculative: {
    label: 'Speculative',
    blurb: 'Lottery tickets — memecoins, airdrops, 5-minute binaries. Small cap; half size even in good regimes, closed in bad ones.',
  },
}

/**
 * Max share of total open notional each book may hold. These are CAPS layered
 * on top of (never replacing) the existing per-position, per-sector,
 * per-counterparty, and per-asset-class limits — a position must clear all of
 * them. They intentionally don't sum to 1: books compete for room.
 */
export const BOOK_NOTIONAL_CAP: Record<StrategyBook, number> = {
  trend:     0.35,
  event:     0.30,
  carry:     0.30,
  info:      0.25,
  arb:       0.20,
  convexity: 0.20,
  speculative: SPECULATIVE_BOOK_CAP,
}

/**
 * Regime rotation multipliers, applied to position size on top of all existing
 * risk controls. Every value is ≤ 1.0 by construction: rotation is expressed
 * by cutting the disfavoured books, never by inflating the favoured ones past
 * what the existing controls allow. CRISIS keeps the established rule — only
 * tail hedging trades (enforced upstream); the zeros here are a second seatbelt.
 */
export type RegimeName = 'RISK_ON' | 'NEUTRAL' | 'RISK_OFF' | 'CRISIS'

export const REGIME_BOOK_MULTIPLIER: Record<RegimeName, Record<StrategyBook, number>> = {
  RISK_ON:  { carry: 1.0, trend: 1.0, event: 1.0, arb: 1.0, info: 1.0, convexity: 1.0, speculative: SPECULATIVE_REGIME_MULTIPLIER.RISK_ON },
  NEUTRAL:  { carry: 1.0, trend: 1.0, event: 1.0, arb: 1.0, info: 1.0, convexity: 1.0, speculative: SPECULATIVE_REGIME_MULTIPLIER.NEUTRAL },
  // Risk-off: carry premia unwind together — cut hardest. Trend and convexity
  // are the books that historically earn here, so they keep full (already
  // regime-haircut) size. Event carries deal-break risk in stress — trimmed.
  RISK_OFF: { carry: 0.5, trend: 1.0, event: 0.7, arb: 0.9, info: 0.9, convexity: 1.0, speculative: SPECULATIVE_REGIME_MULTIPLIER.RISK_OFF },
  CRISIS:   { carry: 0,   trend: 0,   event: 0,   arb: 0,   info: 0,   convexity: 1.0, speculative: SPECULATIVE_REGIME_MULTIPLIER.CRISIS },
}

/** The strategy's label book (where it is shown and primarily budgeted). */
export function bookFor(strategyKey: string): StrategyBook {
  return STRATEGY_BOOK[strategyKey as StrategyKey] ?? 'event'
}

/** Every book a strategy's exposure counts against: its label book, plus its old one if moved. */
export function booksFor(strategyKey: string): StrategyBook[] {
  const primary = bookFor(strategyKey)
  const also = ALSO_COUNTS_AGAINST[strategyKey as StrategyKey]
  return also && also !== primary ? [primary, also] : [primary]
}

export function regimeBookMultiplier(regime: string, book: StrategyBook): number {
  const table = REGIME_BOOK_MULTIPLIER[regime as RegimeName]
  if (!table) return 1.0
  return table[book]
}
