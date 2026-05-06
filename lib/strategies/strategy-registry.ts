/**
 * Canonical strategy registry — single source of truth for every strategy key
 * and its AI configuration (MiroFish tier, Kronos mode, edge type, broker, asset class).
 *
 * Import STRATEGY_REGISTRY_CONFIG for gating decisions; import StrategyKey for
 * typed job payloads across workers and API routes.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type StrategyKey =
  | 'vcp_minervini'
  | 'quant_momentum'
  | 'qvm_multifactor'
  | 'dividend_aristocrat'
  | 'sector_rotation'
  | 'pead'
  | 'options_wheel'
  | 'gamma_exposure'
  | 'merger_arb'
  | 'spinoff'
  | 'tail_risk_hedging'
  | 'autopilot_congressional'
  | 'dca_halving'
  | 'funding_basis_arb'
  | 'onchain_signal'
  | 'defi_yield'
  | 'narrative_rotation'
  | 'liquidation_hunting'
  | 'airdrop_farming'
  | 'memecoin_bondingcurve'
  | 'ict_smc'
  | 'carry_trade'
  | 'cot_positioning'
  | 'cb_divergence'
  | 'session_breakout'
  | 'fx_trendfollowing'
  | 'macro_news_event'
  | 'triangular_arb'
  | 'correlation_divergence'
  | 'polymarket_resolution_rules'
  | 'polymarket_base_rate'
  | 'polymarket_info_lag'
  | 'polymarket_cross_market'
  | 'polymarket_event_compression'
  | 'polymarket_narrative_fade'
  | 'polymarket_liquidity_pocket'
  | 'polymarket_no_trade'
  | 'polymarket_wallet_copy'
  | 'polymarket_crypto_binary_5min'
  | 'cex_latency_arb'
  | 'polymarket_market_maker'
  | 'polymarket_kalshi_weather'
  // ── TIER 3 strategies ──────────────────────────────────────────────────────
  | 'activist_13d_insider_cluster'
  | 'buyback_announcement_momentum'
  | 'etf_basis_arb'
  | 'lst_basis_arb'
  | 'rwa_yield_stack'
  | 'london_4pm_fix_endmonth'
  | 'swap_point_arbitrage'
  | 'prediction_market_sportsbook_arb'
  // ── TIER 4 strategies ──────────────────────────────────────────────────────
  | 'polymarket_triangle_arb'

export type MiroFishTier = 'high' | 'medium' | 'skip'
export type KronosTier = 'high' | 'medium' | 'skip'
export type EdgeType =
  | 'rules' | 'information' | 'structural' | 'sentiment' | 'liquidity'
  | 'flow' | 'event' | 'meta' | 'fundamental' | 'technical' | 'macro' | 'onchain'
export type DefaultBroker =
  | 'alpaca' | 'ibkr' | 'tradier' | 'coinbase' | 'kraken'
  | 'binance_us' | 'oanda' | 'tastyfx' | 'polymarket'
export type AssetClass = 'stocks' | 'options' | 'crypto' | 'forex' | 'polymarket' | 'multi-asset'

export type OrderBookImbalanceTier = 'pre-entry-confirm' | 'skip'

export type ProfileKey = 'vault' | 'conservative' | 'balanced' | 'growth' | 'speculative'

export interface StrategyAIConfig {
  mirofish: MiroFishTier
  kronos: KronosTier
  edgeType: EdgeType
  defaultBroker: DefaultBroker
  assetClass: AssetClass
  /** Optional: 'pre-entry-confirm' runs the imbalance check before sizing. Default: 'skip'. */
  orderBookImbalance?: OrderBookImbalanceTier
  /** Env vars that must be set for this strategy to produce signals at all. */
  requiredEnv?: string[]
  /** Env vars that enhance signals but the strategy runs without them. */
  optionalEnv?: string[]
  /** Risk profiles that may trade this strategy. Inherits upward (balanced implies growth+speculative too). */
  enabledInProfiles: ProfileKey[]
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const STRATEGY_REGISTRY_CONFIG: Record<StrategyKey, StrategyAIConfig> = {
  // ── SKIP — purely systematic / rules-based, no narrative edge ────────────────
  vcp_minervini: {
    mirofish: 'skip', kronos: 'high',
    edgeType: 'technical', defaultBroker: 'alpaca', assetClass: 'stocks',
    orderBookImbalance: 'pre-entry-confirm',
    optionalEnv: ['POLYGON_API_KEY'],
    enabledInProfiles: ['growth', 'speculative'],
  },
  quant_momentum: {
    mirofish: 'skip', kronos: 'high',
    edgeType: 'technical', defaultBroker: 'alpaca', assetClass: 'stocks',
    optionalEnv: ['POLYGON_API_KEY'],
    enabledInProfiles: ['balanced', 'growth', 'speculative'],
  },
  qvm_multifactor: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'fundamental', defaultBroker: 'ibkr', assetClass: 'stocks',
    optionalEnv: ['POLYGON_API_KEY'],
    enabledInProfiles: ['conservative', 'balanced', 'growth', 'speculative'],
  },
  dividend_aristocrat: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'fundamental', defaultBroker: 'alpaca', assetClass: 'stocks',
    enabledInProfiles: ['vault', 'conservative', 'balanced', 'growth', 'speculative'],
  },
  options_wheel: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'structural', defaultBroker: 'tastyfx', assetClass: 'options',
    optionalEnv: ['POLYGON_API_KEY'],
    enabledInProfiles: ['vault', 'conservative', 'balanced', 'growth', 'speculative'],
  },
  funding_basis_arb: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'structural', defaultBroker: 'binance_us', assetClass: 'crypto',
    enabledInProfiles: ['conservative', 'balanced', 'growth', 'speculative'],
  },
  ict_smc: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'technical', defaultBroker: 'oanda', assetClass: 'forex',
    optionalEnv: ['OANDA_API_KEY', 'OANDA_ACCOUNT_ID'],
    enabledInProfiles: ['growth', 'speculative'],
  },
  session_breakout: {
    mirofish: 'skip', kronos: 'high',
    edgeType: 'technical', defaultBroker: 'oanda', assetClass: 'forex',
    optionalEnv: ['OANDA_API_KEY', 'OANDA_ACCOUNT_ID'],
    enabledInProfiles: ['growth', 'speculative'],
  },
  fx_trendfollowing: {
    mirofish: 'skip', kronos: 'high',
    edgeType: 'technical', defaultBroker: 'oanda', assetClass: 'forex',
    optionalEnv: ['OANDA_API_KEY', 'OANDA_ACCOUNT_ID'],
    enabledInProfiles: ['balanced', 'growth', 'speculative'],
  },
  triangular_arb: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'structural', defaultBroker: 'kraken', assetClass: 'crypto',
    optionalEnv: ['OANDA_API_KEY', 'OANDA_ACCOUNT_ID'],
    enabledInProfiles: ['speculative'],
  },
  correlation_divergence: {
    mirofish: 'skip', kronos: 'medium',
    edgeType: 'structural', defaultBroker: 'ibkr', assetClass: 'multi-asset',
    optionalEnv: ['OANDA_API_KEY', 'OANDA_ACCOUNT_ID'],
    enabledInProfiles: ['speculative'],
  },
  memecoin_bondingcurve: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'liquidity', defaultBroker: 'coinbase', assetClass: 'crypto',
    enabledInProfiles: ['speculative'],
  },

  // ── HIGH — narrative/event-driven, every trade benefits from multi-agent sim ─
  polymarket_resolution_rules: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'rules', defaultBroker: 'polymarket', assetClass: 'polymarket',
    enabledInProfiles: ['growth', 'speculative'],
  },
  polymarket_base_rate: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'information', defaultBroker: 'polymarket', assetClass: 'polymarket',
    enabledInProfiles: ['growth', 'speculative'],
  },
  polymarket_info_lag: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'information', defaultBroker: 'polymarket', assetClass: 'polymarket',
    enabledInProfiles: ['balanced', 'growth', 'speculative'],
  },
  polymarket_cross_market: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'structural', defaultBroker: 'polymarket', assetClass: 'polymarket',
    enabledInProfiles: ['growth', 'speculative'],
  },
  polymarket_event_compression: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'event', defaultBroker: 'polymarket', assetClass: 'polymarket',
    enabledInProfiles: ['growth', 'speculative'],
  },
  polymarket_narrative_fade: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'sentiment', defaultBroker: 'polymarket', assetClass: 'polymarket',
    enabledInProfiles: ['speculative'],
  },
  polymarket_liquidity_pocket: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'liquidity', defaultBroker: 'polymarket', assetClass: 'polymarket',
    enabledInProfiles: ['speculative'],
  },
  polymarket_no_trade: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'meta', defaultBroker: 'polymarket', assetClass: 'polymarket',
    enabledInProfiles: ['balanced', 'growth', 'speculative'],
  },
  polymarket_wallet_copy: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'flow', defaultBroker: 'polymarket', assetClass: 'polymarket',
    enabledInProfiles: ['balanced', 'growth', 'speculative'],
  },
  polymarket_crypto_binary_5min: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'information', defaultBroker: 'polymarket', assetClass: 'polymarket',
    enabledInProfiles: ['growth', 'speculative'],
  },
  macro_news_event: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'macro', defaultBroker: 'ibkr', assetClass: 'multi-asset',
    optionalEnv: ['OANDA_API_KEY', 'OANDA_ACCOUNT_ID'],
    enabledInProfiles: ['growth', 'speculative'],
  },
  cb_divergence: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'macro', defaultBroker: 'oanda', assetClass: 'forex',
    optionalEnv: ['OANDA_API_KEY', 'OANDA_ACCOUNT_ID'],
    enabledInProfiles: ['growth', 'speculative'],
  },
  narrative_rotation: {
    mirofish: 'high', kronos: 'medium',
    edgeType: 'sentiment', defaultBroker: 'alpaca', assetClass: 'stocks',
    enabledInProfiles: ['balanced', 'growth', 'speculative'],
  },
  merger_arb: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'event', defaultBroker: 'ibkr', assetClass: 'stocks',
    enabledInProfiles: ['speculative'],
  },
  tail_risk_hedging: {
    mirofish: 'high', kronos: 'high',
    edgeType: 'meta', defaultBroker: 'tastyfx', assetClass: 'options',
    enabledInProfiles: ['speculative'],
  },
  pead: {
    mirofish: 'high', kronos: 'medium',
    edgeType: 'event', defaultBroker: 'alpaca', assetClass: 'stocks',
    orderBookImbalance: 'pre-entry-confirm',
    optionalEnv: ['FINNHUB_API_KEY'],
    enabledInProfiles: ['balanced', 'growth', 'speculative'],
  },

  // ── MEDIUM — conditional on regime; Claude fallback is acceptable ─────────────
  sector_rotation: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'macro', defaultBroker: 'alpaca', assetClass: 'stocks',
    enabledInProfiles: ['conservative', 'balanced', 'growth', 'speculative'],
  },
  spinoff: {
    mirofish: 'medium', kronos: 'medium',
    edgeType: 'event', defaultBroker: 'ibkr', assetClass: 'stocks',
    enabledInProfiles: ['speculative'],
  },
  dca_halving: {
    mirofish: 'medium', kronos: 'medium',
    edgeType: 'onchain', defaultBroker: 'coinbase', assetClass: 'crypto',
    optionalEnv: ['GLASSNODE_API_KEY'],
    enabledInProfiles: ['vault', 'conservative', 'balanced', 'growth', 'speculative'],
  },
  defi_yield: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'onchain', defaultBroker: 'coinbase', assetClass: 'crypto',
    enabledInProfiles: ['vault', 'conservative', 'balanced', 'growth', 'speculative'],
  },
  onchain_signal: {
    mirofish: 'medium', kronos: 'high',
    edgeType: 'onchain', defaultBroker: 'coinbase', assetClass: 'crypto',
    orderBookImbalance: 'pre-entry-confirm',
    optionalEnv: ['GLASSNODE_API_KEY'],
    enabledInProfiles: ['balanced', 'growth', 'speculative'],
  },
  liquidation_hunting: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'liquidity', defaultBroker: 'kraken', assetClass: 'crypto',
    enabledInProfiles: ['growth', 'speculative'],
  },
  airdrop_farming: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'flow', defaultBroker: 'coinbase', assetClass: 'crypto',
    enabledInProfiles: ['speculative'],
  },
  carry_trade: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'macro', defaultBroker: 'oanda', assetClass: 'forex',
    optionalEnv: ['OANDA_API_KEY', 'OANDA_ACCOUNT_ID'],
    enabledInProfiles: ['conservative', 'balanced', 'growth', 'speculative'],
  },
  cot_positioning: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'flow', defaultBroker: 'ibkr', assetClass: 'multi-asset',
    enabledInProfiles: ['conservative', 'balanced', 'growth', 'speculative'],
  },
  gamma_exposure: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'structural', defaultBroker: 'tastyfx', assetClass: 'options',
    orderBookImbalance: 'pre-entry-confirm',
    optionalEnv: ['POLYGON_API_KEY'],
    enabledInProfiles: ['speculative'],
  },
  autopilot_congressional: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'flow', defaultBroker: 'alpaca', assetClass: 'stocks',
    optionalEnv: ['QUIVER_QUANT_API_KEY'],
    enabledInProfiles: ['growth', 'speculative'],
  },
  cex_latency_arb: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'structural', defaultBroker: 'coinbase', assetClass: 'crypto',
    enabledInProfiles: ['speculative'],
  },
  polymarket_market_maker: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'liquidity', defaultBroker: 'polymarket', assetClass: 'polymarket',
    optionalEnv: ['POLYMARKET_PRIVATE_KEY'],
    enabledInProfiles: ['speculative'],
  },
  polymarket_kalshi_weather: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'information', defaultBroker: 'polymarket', assetClass: 'polymarket',
    optionalEnv: ['KALSHI_API_KEY', 'KALSHI_API_SECRET'],
    enabledInProfiles: ['growth', 'speculative'],
  },

  // ── TIER 3 strategies (all default-disabled in user_enabled_strategies) ──────

  activist_13d_insider_cluster: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'flow', defaultBroker: 'alpaca', assetClass: 'stocks',
    optionalEnv: ['POLYGON_API_KEY'],
    enabledInProfiles: ['growth', 'speculative'],
  },
  buyback_announcement_momentum: {
    mirofish: 'medium', kronos: 'medium',
    edgeType: 'event', defaultBroker: 'alpaca', assetClass: 'stocks',
    optionalEnv: ['POLYGON_API_KEY'],
    enabledInProfiles: ['balanced', 'growth', 'speculative'],
  },
  etf_basis_arb: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'structural', defaultBroker: 'alpaca', assetClass: 'multi-asset',
    enabledInProfiles: ['vault', 'conservative', 'balanced', 'growth', 'speculative'],
  },
  lst_basis_arb: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'structural', defaultBroker: 'coinbase', assetClass: 'crypto',
    enabledInProfiles: ['conservative', 'balanced', 'growth', 'speculative'],
  },
  rwa_yield_stack: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'fundamental', defaultBroker: 'coinbase', assetClass: 'crypto',
    optionalEnv: ['FRED_API_KEY'],
    enabledInProfiles: ['vault', 'conservative', 'balanced', 'growth', 'speculative'],
  },
  london_4pm_fix_endmonth: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'flow', defaultBroker: 'oanda', assetClass: 'forex',
    optionalEnv: ['OANDA_API_KEY', 'OANDA_ACCOUNT_ID'],
    enabledInProfiles: ['balanced', 'growth', 'speculative'],
  },
  swap_point_arbitrage: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'structural', defaultBroker: 'oanda', assetClass: 'forex',
    optionalEnv: ['OANDA_API_KEY', 'OANDA_ACCOUNT_ID'],
    enabledInProfiles: ['speculative'],
  },
  prediction_market_sportsbook_arb: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'structural', defaultBroker: 'polymarket', assetClass: 'polymarket',
    optionalEnv: ['PINNACLE_API_KEY'],
    enabledInProfiles: ['speculative'],
  },
  polymarket_triangle_arb: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'structural', defaultBroker: 'polymarket', assetClass: 'polymarket',
    optionalEnv: ['PINNACLE_API_KEY', 'KALSHI_API_KEY'],
    enabledInProfiles: ['speculative'],
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns config for a key, defaulting to medium/medium when unlisted. */
export function getStrategyConfig(key: StrategyKey): StrategyAIConfig {
  return STRATEGY_REGISTRY_CONFIG[key]
}

/** Type guard — true when `s` is a known StrategyKey. */
export function isStrategyKey(s: string): s is StrategyKey {
  return s in STRATEGY_REGISTRY_CONFIG
}
