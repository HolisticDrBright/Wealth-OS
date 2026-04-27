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

export interface StrategyAIConfig {
  mirofish: MiroFishTier
  kronos: KronosTier
  edgeType: EdgeType
  defaultBroker: DefaultBroker
  assetClass: AssetClass
  /** Optional: 'pre-entry-confirm' runs the imbalance check before sizing. Default: 'skip'. */
  orderBookImbalance?: OrderBookImbalanceTier
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const STRATEGY_REGISTRY_CONFIG: Record<StrategyKey, StrategyAIConfig> = {
  // ── SKIP — purely systematic / rules-based, no narrative edge ────────────────
  vcp_minervini: {
    mirofish: 'skip', kronos: 'high',
    edgeType: 'technical', defaultBroker: 'alpaca', assetClass: 'stocks',
    orderBookImbalance: 'pre-entry-confirm',
  },
  quant_momentum: {
    mirofish: 'skip', kronos: 'high',
    edgeType: 'technical', defaultBroker: 'alpaca', assetClass: 'stocks',
  },
  qvm_multifactor: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'fundamental', defaultBroker: 'ibkr', assetClass: 'stocks',
  },
  dividend_aristocrat: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'fundamental', defaultBroker: 'alpaca', assetClass: 'stocks',
  },
  options_wheel: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'structural', defaultBroker: 'tastyfx', assetClass: 'options',
  },
  funding_basis_arb: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'structural', defaultBroker: 'binance_us', assetClass: 'crypto',
  },
  ict_smc: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'technical', defaultBroker: 'oanda', assetClass: 'forex',
  },
  session_breakout: {
    mirofish: 'skip', kronos: 'high',
    edgeType: 'technical', defaultBroker: 'oanda', assetClass: 'forex',
  },
  fx_trendfollowing: {
    mirofish: 'skip', kronos: 'high',
    edgeType: 'technical', defaultBroker: 'oanda', assetClass: 'forex',
  },
  triangular_arb: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'structural', defaultBroker: 'kraken', assetClass: 'crypto',
  },
  correlation_divergence: {
    mirofish: 'skip', kronos: 'medium',
    edgeType: 'structural', defaultBroker: 'ibkr', assetClass: 'multi-asset',
  },
  memecoin_bondingcurve: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'liquidity', defaultBroker: 'coinbase', assetClass: 'crypto',
  },

  // ── HIGH — narrative/event-driven, every trade benefits from multi-agent sim ─
  polymarket_resolution_rules: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'rules', defaultBroker: 'polymarket', assetClass: 'polymarket',
  },
  polymarket_base_rate: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'information', defaultBroker: 'polymarket', assetClass: 'polymarket',
  },
  polymarket_info_lag: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'information', defaultBroker: 'polymarket', assetClass: 'polymarket',
  },
  polymarket_cross_market: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'structural', defaultBroker: 'polymarket', assetClass: 'polymarket',
  },
  polymarket_event_compression: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'event', defaultBroker: 'polymarket', assetClass: 'polymarket',
  },
  polymarket_narrative_fade: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'sentiment', defaultBroker: 'polymarket', assetClass: 'polymarket',
  },
  polymarket_liquidity_pocket: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'liquidity', defaultBroker: 'polymarket', assetClass: 'polymarket',
  },
  polymarket_no_trade: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'meta', defaultBroker: 'polymarket', assetClass: 'polymarket',
  },
  polymarket_wallet_copy: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'flow', defaultBroker: 'polymarket', assetClass: 'polymarket',
  },
  polymarket_crypto_binary_5min: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'information', defaultBroker: 'polymarket', assetClass: 'polymarket',
  },
  macro_news_event: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'macro', defaultBroker: 'ibkr', assetClass: 'multi-asset',
  },
  cb_divergence: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'macro', defaultBroker: 'oanda', assetClass: 'forex',
  },
  narrative_rotation: {
    mirofish: 'high', kronos: 'medium',
    edgeType: 'sentiment', defaultBroker: 'alpaca', assetClass: 'stocks',
  },
  merger_arb: {
    mirofish: 'high', kronos: 'skip',
    edgeType: 'event', defaultBroker: 'ibkr', assetClass: 'stocks',
  },
  tail_risk_hedging: {
    mirofish: 'high', kronos: 'high',
    edgeType: 'meta', defaultBroker: 'tastyfx', assetClass: 'options',
  },
  pead: {
    mirofish: 'high', kronos: 'medium',
    edgeType: 'event', defaultBroker: 'alpaca', assetClass: 'stocks',
    orderBookImbalance: 'pre-entry-confirm',
  },

  // ── MEDIUM — conditional on regime; Claude fallback is acceptable ─────────────
  sector_rotation: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'macro', defaultBroker: 'alpaca', assetClass: 'stocks',
  },
  spinoff: {
    mirofish: 'medium', kronos: 'medium',
    edgeType: 'event', defaultBroker: 'ibkr', assetClass: 'stocks',
  },
  dca_halving: {
    mirofish: 'medium', kronos: 'medium',
    edgeType: 'onchain', defaultBroker: 'coinbase', assetClass: 'crypto',
  },
  defi_yield: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'onchain', defaultBroker: 'coinbase', assetClass: 'crypto',
  },
  onchain_signal: {
    mirofish: 'medium', kronos: 'high',
    edgeType: 'onchain', defaultBroker: 'coinbase', assetClass: 'crypto',
    orderBookImbalance: 'pre-entry-confirm',
  },
  liquidation_hunting: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'liquidity', defaultBroker: 'kraken', assetClass: 'crypto',
  },
  airdrop_farming: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'flow', defaultBroker: 'coinbase', assetClass: 'crypto',
  },
  carry_trade: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'macro', defaultBroker: 'oanda', assetClass: 'forex',
  },
  cot_positioning: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'flow', defaultBroker: 'ibkr', assetClass: 'multi-asset',
  },
  gamma_exposure: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'structural', defaultBroker: 'tastyfx', assetClass: 'options',
    orderBookImbalance: 'pre-entry-confirm',
  },
  autopilot_congressional: {
    mirofish: 'medium', kronos: 'skip',
    edgeType: 'flow', defaultBroker: 'alpaca', assetClass: 'stocks',
  },
  cex_latency_arb: {
    mirofish: 'skip', kronos: 'skip',
    edgeType: 'structural', defaultBroker: 'coinbase', assetClass: 'crypto',
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
