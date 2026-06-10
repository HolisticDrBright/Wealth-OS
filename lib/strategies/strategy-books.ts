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
 *
 * The map below is exhaustive over StrategyKey (compile-time enforced), so a
 * new strategy cannot be registered without declaring its book.
 */

import type { StrategyKey } from './strategy-registry'

export type StrategyBook = 'carry' | 'convexity' | 'trend' | 'event' | 'arb' | 'info'

export const ALL_BOOKS: StrategyBook[] = ['carry', 'convexity', 'trend', 'event', 'arb', 'info']

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
  memecoin_bondingcurve:    'trend',
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
  airdrop_farming:          'carry',     // farm-and-harvest income profile
  polymarket_market_maker:  'carry',     // bid-ask income, short-tail profile
  odte_strangle_hedged:     'carry',     // stub — never executes, classified for completeness
  ibit_vol_skew:            'carry',     // stub — never executes

  // ── Convexity / tail ────────────────────────────────────────────────────────
  tail_risk_hedging:        'convexity',
  vix_term_structure:       'convexity',
  jpy_intervention_fade:    'convexity',
  gamma_exposure:           'convexity', // vol-regime structure trades
  liquidation_hunting:      'convexity', // profits from forced-seller cascades
  factor_crowded_trade_fade:'convexity', // stub — never executes

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
  polymarket_crypto_binary_5min: 'info',
  polymarket_kalshi_weather:'info',
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
  RISK_ON:  { carry: 1.0, trend: 1.0, event: 1.0, arb: 1.0, info: 1.0, convexity: 1.0 },
  NEUTRAL:  { carry: 1.0, trend: 1.0, event: 1.0, arb: 1.0, info: 1.0, convexity: 1.0 },
  // Risk-off: carry premia unwind together — cut hardest. Trend and convexity
  // are the books that historically earn here, so they keep full (already
  // regime-haircut) size. Event carries deal-break risk in stress — trimmed.
  RISK_OFF: { carry: 0.5, trend: 1.0, event: 0.7, arb: 0.9, info: 0.9, convexity: 1.0 },
  CRISIS:   { carry: 0,   trend: 0,   event: 0,   arb: 0,   info: 0,   convexity: 1.0 },
}

export function bookFor(strategyKey: string): StrategyBook {
  return STRATEGY_BOOK[strategyKey as StrategyKey] ?? 'event'
}

export function regimeBookMultiplier(regime: string, book: StrategyBook): number {
  const table = REGIME_BOOK_MULTIPLIER[regime as RegimeName]
  if (!table) return 1.0
  return table[book]
}
