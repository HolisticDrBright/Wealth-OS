/**
 * Correlation-aware position sizing caps (T4.4).
 *
 * Prevents over-concentration in correlated positions by enforcing
 * portfolio-level caps before a new position is added.
 *
 * Caps (% of total portfolio):
 *   per-sector       25%   — e.g., all tech stocks, all DeFi
 *   per-factor       35%   — e.g., all momentum, all value, all arb
 *   per-counterparty 30%   — e.g., all Polymarket, all OANDA positions
 *   per-asset-class  50%   — e.g., total crypto exposure
 *
 * Usage:
 *   const cappedSize = applyCorrelationCaps(opp, currentBook, rawSize, portfolioUsd)
 */

import type { StrategyKey, AssetClass } from '@/lib/strategies/strategy-registry'

export interface BookPosition {
  strategyKey: StrategyKey
  assetClass: AssetClass
  notionalUsd: number
}

export interface CorrelationCappedSize {
  notionalUsd: number
  fraction: number
  capApplied: string | null   // name of binding cap, or null if no cap hit
}

// ─── Sector / factor mapping ──────────────────────────────────────────────────

const SECTOR_MAP: Partial<Record<StrategyKey, string>> = {
  vcp_minervini:                  'tech_growth',
  quant_momentum:                 'momentum',
  qvm_multifactor:                'momentum',
  dividend_aristocrat:            'dividend_income',
  sector_rotation:                'macro',
  pead:                           'event_driven',
  options_wheel:                  'income',
  gamma_exposure:                 'volatility',
  merger_arb:                     'event_driven',
  spinoff:                        'event_driven',
  tail_risk_hedging:              'tail_risk',
  autopilot_congressional:        'event_driven',
  activist_13d_insider_cluster:   'event_driven',
  buyback_announcement_momentum:  'event_driven',
  dca_halving:                    'crypto_beta',
  funding_basis_arb:              'crypto_arb',
  cex_latency_arb:                'crypto_arb',
  onchain_signal:                 'crypto_alpha',
  defi_yield:                     'crypto_yield',
  narrative_rotation:             'crypto_beta',
  liquidation_hunting:            'crypto_alpha',
  airdrop_farming:                'crypto_alpha',
  memecoin_bondingcurve:          'crypto_alpha',
  etf_basis_arb:                  'crypto_arb',
  lst_basis_arb:                  'crypto_arb',
  rwa_yield_stack:                'crypto_yield',
  ict_smc:                        'forex_technical',
  carry_trade:                    'forex_carry',
  cot_positioning:                'forex_macro',
  cb_divergence:                  'forex_macro',
  session_breakout:               'forex_technical',
  fx_trendfollowing:              'forex_technical',
  macro_news_event:               'forex_macro',
  triangular_arb:                 'forex_arb',
  correlation_divergence:         'forex_arb',
  london_4pm_fix_endmonth:        'forex_flow',
  swap_point_arbitrage:           'forex_arb',
  polymarket_resolution_rules:    'pm_structural',
  polymarket_base_rate:           'pm_structural',
  polymarket_info_lag:            'pm_alpha',
  polymarket_cross_market:        'pm_arb',
  polymarket_event_compression:   'pm_structural',
  polymarket_narrative_fade:      'pm_alpha',
  polymarket_liquidity_pocket:    'pm_alpha',
  polymarket_no_trade:            'pm_structural',
  polymarket_wallet_copy:         'pm_alpha',
  polymarket_crypto_binary_5min:  'pm_arb',
  polymarket_market_maker:        'pm_structural',
  polymarket_kalshi_weather:      'pm_alpha',
  prediction_market_sportsbook_arb: 'pm_arb',
  polymarket_triangle_arb:        'pm_arb',
}

const FACTOR_MAP: Partial<Record<StrategyKey, string>> = {
  vcp_minervini:                  'momentum',
  quant_momentum:                 'momentum',
  qvm_multifactor:                'multi_factor',
  dividend_aristocrat:            'quality_income',
  autopilot_congressional:        'information_edge',
  activist_13d_insider_cluster:   'information_edge',
  buyback_announcement_momentum:  'corporate_action',
  pead:                           'corporate_action',
  spinoff:                        'corporate_action',
  merger_arb:                     'arbitrage',
  funding_basis_arb:              'arbitrage',
  cex_latency_arb:                'arbitrage',
  triangular_arb:                 'arbitrage',
  etf_basis_arb:                  'arbitrage',
  lst_basis_arb:                  'arbitrage',
  polymarket_cross_market:        'arbitrage',
  prediction_market_sportsbook_arb: 'arbitrage',
  polymarket_triangle_arb:        'arbitrage',
  carry_trade:                    'carry',
  swap_point_arbitrage:           'carry',
  defi_yield:                     'carry',
  rwa_yield_stack:                'carry',
  tail_risk_hedging:              'hedge',
  gamma_exposure:                 'volatility',
}

const COUNTERPARTY_MAP: Partial<Record<StrategyKey, string>> = {
  vcp_minervini:                  'alpaca',
  quant_momentum:                 'alpaca',
  qvm_multifactor:                'alpaca',
  dividend_aristocrat:            'alpaca',
  sector_rotation:                'alpaca',
  pead:                           'alpaca',
  options_wheel:                  'alpaca',
  gamma_exposure:                 'alpaca',
  merger_arb:                     'alpaca',
  spinoff:                        'alpaca',
  tail_risk_hedging:              'alpaca',
  autopilot_congressional:        'alpaca',
  activist_13d_insider_cluster:   'alpaca',
  buyback_announcement_momentum:  'alpaca',
  dca_halving:                    'kraken',
  funding_basis_arb:              'kraken',
  cex_latency_arb:                'kraken',
  onchain_signal:                 'kraken',
  defi_yield:                     'kraken',
  narrative_rotation:             'kraken',
  liquidation_hunting:            'kraken',
  airdrop_farming:                'kraken',
  memecoin_bondingcurve:          'kraken',
  etf_basis_arb:                  'kraken',
  lst_basis_arb:                  'kraken',
  rwa_yield_stack:                'kraken',
  ict_smc:                        'oanda',
  carry_trade:                    'oanda',
  cot_positioning:                'oanda',
  cb_divergence:                  'oanda',
  session_breakout:               'oanda',
  fx_trendfollowing:              'oanda',
  macro_news_event:               'oanda',
  triangular_arb:                 'oanda',
  correlation_divergence:         'oanda',
  london_4pm_fix_endmonth:        'oanda',
  swap_point_arbitrage:           'oanda',
  polymarket_resolution_rules:    'polymarket',
  polymarket_base_rate:           'polymarket',
  polymarket_info_lag:            'polymarket',
  polymarket_cross_market:        'polymarket',
  polymarket_event_compression:   'polymarket',
  polymarket_narrative_fade:      'polymarket',
  polymarket_liquidity_pocket:    'polymarket',
  polymarket_no_trade:            'polymarket',
  polymarket_wallet_copy:         'polymarket',
  polymarket_crypto_binary_5min:  'polymarket',
  polymarket_market_maker:        'polymarket',
  polymarket_kalshi_weather:      'polymarket',
  prediction_market_sportsbook_arb: 'polymarket',
  polymarket_triangle_arb:        'polymarket',
}

// ─── Cap constants ────────────────────────────────────────────────────────────

const CAP_SECTOR_PCT       = 0.25
const CAP_FACTOR_PCT       = 0.35
const CAP_COUNTERPARTY_PCT = 0.30
const CAP_ASSET_CLASS_PCT  = 0.50

// ─── Main function ────────────────────────────────────────────────────────────

export function applyCorrelationCaps(
  strategyKey: StrategyKey,
  assetClass: AssetClass,
  rawNotional: number,
  portfolioUsd: number,
  currentBook: BookPosition[]
): CorrelationCappedSize {
  if (portfolioUsd <= 0) {
    return { notionalUsd: rawNotional, fraction: 0, capApplied: null }
  }

  const sector       = SECTOR_MAP[strategyKey]
  const factor       = FACTOR_MAP[strategyKey]
  const counterparty = COUNTERPARTY_MAP[strategyKey]

  const existing = {
    sector:       currentBook.filter(p => SECTOR_MAP[p.strategyKey]       === sector       && sector).reduce((s, p) => s + p.notionalUsd, 0),
    factor:       currentBook.filter(p => FACTOR_MAP[p.strategyKey]       === factor       && factor).reduce((s, p) => s + p.notionalUsd, 0),
    counterparty: currentBook.filter(p => COUNTERPARTY_MAP[p.strategyKey] === counterparty && counterparty).reduce((s, p) => s + p.notionalUsd, 0),
    assetClass:   currentBook.filter(p => p.assetClass === assetClass).reduce((s, p) => s + p.notionalUsd, 0),
  }

  const caps = [
    { name: 'sector',       max: portfolioUsd * CAP_SECTOR_PCT,       used: existing.sector,       active: !!sector },
    { name: 'factor',       max: portfolioUsd * CAP_FACTOR_PCT,       used: existing.factor,       active: !!factor },
    { name: 'counterparty', max: portfolioUsd * CAP_COUNTERPARTY_PCT, used: existing.counterparty, active: !!counterparty },
    { name: 'asset_class',  max: portfolioUsd * CAP_ASSET_CLASS_PCT,  used: existing.assetClass,   active: true },
  ]

  let capped = rawNotional
  let capApplied: string | null = null

  for (const cap of caps) {
    if (!cap.active) continue
    const available = Math.max(0, cap.max - cap.used)
    if (rawNotional > available) {
      const limited = Math.min(capped, available)
      if (limited < capped) {
        capped = limited
        capApplied = cap.name
      }
    }
  }

  capped = Math.max(0, capped)

  return {
    notionalUsd: capped,
    fraction: capped / portfolioUsd,
    capApplied,
  }
}
