/**
 * Centralized broker routing — single source of truth for:
 *   - Which brokers exist and their fee/legal metadata
 *   - Which broker to use for each asset class (primary + fallback)
 *   - Jurisdiction-aware selectBroker() with typed reason codes
 *
 * Builds on top of lib/broker-adapters/ (the concrete HTTP implementations).
 * Import this module for routing decisions; import broker-adapters/ for
 * actual order execution.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Broker =
  | 'alpaca'
  | 'ibkr'
  | 'tradier'
  | 'tradestation'
  | 'coinbase'
  | 'kraken'
  | 'binance_us'
  | 'kraken_futures'
  | 'oanda'
  | 'tastyfx'
  | 'forex_com'
  | 'polymarket'
  | 'kalshi'

export type AssetClass =
  | 'stocks'
  | 'options'
  | 'crypto_spot'
  | 'crypto_perp'
  | 'forex'
  | 'polymarket'
  | 'futures'

export type LegalStatus =
  | 'us_retail_ok'
  | 'us_retail_restricted'
  | 'us_unavailable'
  | 'global_only'

export type ApiTier = 'free' | 'paid' | 'institutional'

export type Jurisdiction = 'us' | 'eu' | 'uk' | 'sg' | 'au' | 'other'

export interface BrokerFees {
  perTradeBps: number         // commission in basis points (0 = free)
  perContractCents?: number   // for options
  takerBps?: number           // for crypto/prediction markets
  makerBps?: number
}

export interface BrokerConfig {
  broker: Broker
  displayName: string
  apiTier: ApiTier
  legalStatus: LegalStatus
  supportsPaperTrading: boolean
  supportsFractionalShares: boolean
  baseUrlEnvKey: string
  apiKeyEnvKey: string
  apiSecretEnvKey?: string
  accountIdEnvKey?: string
  fees: BrokerFees
  /** Asset classes this broker handles (maps to AssetClass values) */
  assetClasses: AssetClass[]
}

export interface SelectBrokerResult {
  broker: Broker
  reason: 'user_override' | 'default' | 'fallback_legal'
  config: BrokerConfig
}

// ─── Broker registry ──────────────────────────────────────────────────────────

export const BROKER_CONFIGS: Record<Broker, BrokerConfig> = {
  alpaca: {
    broker: 'alpaca',
    displayName: 'Alpaca Markets',
    apiTier: 'free',
    legalStatus: 'us_retail_ok',
    supportsPaperTrading: true,
    supportsFractionalShares: true,
    baseUrlEnvKey: 'ALPACA_BASE_URL',
    apiKeyEnvKey: 'ALPACA_API_KEY',
    apiSecretEnvKey: 'ALPACA_SECRET_KEY',
    fees: { perTradeBps: 0 },
    assetClasses: ['stocks', 'options', 'crypto_spot'],
  },
  ibkr: {
    broker: 'ibkr',
    displayName: 'Interactive Brokers',
    apiTier: 'institutional',
    legalStatus: 'us_retail_ok',
    supportsPaperTrading: true,
    supportsFractionalShares: true,
    baseUrlEnvKey: 'IBKR_API_URL',
    apiKeyEnvKey: 'IBKR_ACCOUNT_ID',
    fees: { perTradeBps: 1, perContractCents: 65 },
    assetClasses: ['stocks', 'options', 'futures', 'forex', 'crypto_spot'],
  },
  tradier: {
    broker: 'tradier',
    displayName: 'Tradier',
    apiTier: 'free',
    legalStatus: 'us_retail_ok',
    supportsPaperTrading: true,
    supportsFractionalShares: false,
    baseUrlEnvKey: 'TRADIER_BASE_URL',
    apiKeyEnvKey: 'TRADIER_API_KEY',
    fees: { perTradeBps: 0, perContractCents: 35 },
    assetClasses: ['stocks', 'options'],
  },
  tradestation: {
    broker: 'tradestation',
    displayName: 'TradeStation',
    apiTier: 'paid',
    legalStatus: 'us_retail_ok',
    supportsPaperTrading: true,
    supportsFractionalShares: false,
    baseUrlEnvKey: 'TRADESTATION_BASE_URL',
    apiKeyEnvKey: 'TRADESTATION_API_KEY',
    apiSecretEnvKey: 'TRADESTATION_API_SECRET',
    fees: { perTradeBps: 0, perContractCents: 50 },
    assetClasses: ['stocks', 'options', 'futures'],
  },
  coinbase: {
    broker: 'coinbase',
    displayName: 'Coinbase Advanced Trade',
    apiTier: 'free',
    legalStatus: 'us_retail_ok',
    supportsPaperTrading: false,
    supportsFractionalShares: true,
    baseUrlEnvKey: 'COINBASE_BASE_URL',
    apiKeyEnvKey: 'COINBASE_API_KEY',
    apiSecretEnvKey: 'COINBASE_API_SECRET',
    fees: { perTradeBps: 0, takerBps: 60, makerBps: 40 },
    assetClasses: ['crypto_spot'],
  },
  kraken: {
    broker: 'kraken',
    displayName: 'Kraken',
    apiTier: 'free',
    legalStatus: 'us_retail_ok',
    supportsPaperTrading: false,
    supportsFractionalShares: true,
    baseUrlEnvKey: 'KRAKEN_BASE_URL',
    apiKeyEnvKey: 'KRAKEN_API_KEY',
    apiSecretEnvKey: 'KRAKEN_API_SECRET',
    fees: { perTradeBps: 0, takerBps: 40, makerBps: 16 },
    assetClasses: ['crypto_spot'],
  },
  binance_us: {
    broker: 'binance_us',
    displayName: 'Binance US',
    apiTier: 'free',
    legalStatus: 'us_retail_restricted',
    supportsPaperTrading: false,
    supportsFractionalShares: true,
    baseUrlEnvKey: 'BINANCE_US_BASE_URL',
    apiKeyEnvKey: 'BINANCE_API_KEY',
    apiSecretEnvKey: 'BINANCE_API_SECRET',
    fees: { perTradeBps: 0, takerBps: 10, makerBps: 10 },
    assetClasses: ['crypto_spot', 'crypto_perp'],
  },
  kraken_futures: {
    broker: 'kraken_futures',
    displayName: 'Kraken Futures',
    apiTier: 'free',
    legalStatus: 'us_unavailable',
    supportsPaperTrading: true,
    supportsFractionalShares: false,
    baseUrlEnvKey: 'KRAKEN_FUTURES_BASE_URL',
    apiKeyEnvKey: 'KRAKEN_FUTURES_API_KEY',
    apiSecretEnvKey: 'KRAKEN_FUTURES_API_SECRET',
    fees: { takerBps: 5, makerBps: 2, perTradeBps: 0 },
    assetClasses: ['crypto_perp', 'crypto_spot'],
  },
  oanda: {
    broker: 'oanda',
    displayName: 'OANDA',
    apiTier: 'free',
    legalStatus: 'us_retail_ok',
    supportsPaperTrading: true,
    supportsFractionalShares: false,
    baseUrlEnvKey: 'OANDA_BASE_URL',
    apiKeyEnvKey: 'OANDA_API_KEY',
    accountIdEnvKey: 'OANDA_ACCOUNT_ID',
    fees: { perTradeBps: 0, takerBps: 10, makerBps: 10 },
    assetClasses: ['forex'],
  },
  tastyfx: {
    broker: 'tastyfx',
    displayName: 'tastyfx',
    apiTier: 'free',
    legalStatus: 'us_retail_ok',
    supportsPaperTrading: false,
    supportsFractionalShares: false,
    baseUrlEnvKey: 'TASTYFX_BASE_URL',
    apiKeyEnvKey: 'TASTYFX_API_KEY',
    apiSecretEnvKey: 'TASTYFX_API_SECRET',
    fees: { perTradeBps: 0, takerBps: 13, makerBps: 13 },
    assetClasses: ['forex', 'options'],
  },
  forex_com: {
    broker: 'forex_com',
    displayName: 'FOREX.com',
    apiTier: 'paid',
    legalStatus: 'us_retail_ok',
    supportsPaperTrading: true,
    supportsFractionalShares: false,
    baseUrlEnvKey: 'FOREX_COM_BASE_URL',
    apiKeyEnvKey: 'FOREX_COM_API_KEY',
    apiSecretEnvKey: 'FOREX_COM_API_SECRET',
    fees: { perTradeBps: 0, takerBps: 12, makerBps: 12 },
    assetClasses: ['forex', 'futures'],
  },
  polymarket: {
    broker: 'polymarket',
    displayName: 'Polymarket',
    apiTier: 'free',
    legalStatus: 'us_unavailable',
    supportsPaperTrading: false,
    supportsFractionalShares: false,
    baseUrlEnvKey: 'POLYMARKET_BASE_URL',
    apiKeyEnvKey: 'POLYMARKET_PRIVATE_KEY',
    fees: { perTradeBps: 0, takerBps: 0, makerBps: 0 },
    assetClasses: ['polymarket'],
  },
  kalshi: {
    broker: 'kalshi',
    displayName: 'Kalshi',
    apiTier: 'free',
    legalStatus: 'us_retail_ok',
    supportsPaperTrading: true,
    supportsFractionalShares: false,
    baseUrlEnvKey: 'KALSHI_BASE_URL',
    apiKeyEnvKey: 'KALSHI_API_KEY',
    apiSecretEnvKey: 'KALSHI_API_SECRET',
    fees: { perTradeBps: 0, takerBps: 50, makerBps: 50 },
    assetClasses: ['polymarket'],
  },
}

// ─── Primary + fallback per asset class ───────────────────────────────────────

export const ASSET_DEFAULT_BROKER: Record<AssetClass, { primary: Broker; fallback: Broker }> = {
  stocks:      { primary: 'alpaca',         fallback: 'ibkr' },
  options:     { primary: 'tradier',        fallback: 'ibkr' },
  crypto_spot: { primary: 'coinbase',       fallback: 'kraken' },
  crypto_perp: { primary: 'kraken_futures', fallback: 'binance_us' },
  forex:       { primary: 'oanda',          fallback: 'tastyfx' },
  polymarket:  { primary: 'polymarket',     fallback: 'polymarket' },
  futures:     { primary: 'ibkr',           fallback: 'tradestation' },
}

// ─── Jurisdiction helpers ─────────────────────────────────────────────────────

/**
 * Returns true when `broker` is legally available in `jurisdiction`.
 */
export function isBrokerAllowed(broker: Broker, jurisdiction: Jurisdiction): boolean {
  const status = BROKER_CONFIGS[broker].legalStatus
  switch (jurisdiction) {
    case 'us':
      return status === 'us_retail_ok' || status === 'us_retail_restricted'
    case 'eu':
    case 'uk':
    case 'sg':
    case 'au':
      // us_unavailable means "not for US retail" — internationally these brokers are fine
      return true
    case 'other':
      return true
    default:
      return true
  }
}

// ─── selectBroker ─────────────────────────────────────────────────────────────

/**
 * Select the correct broker for an order.
 *
 * Priority:
 *   1. userOverride (if legally allowed in jurisdiction)
 *   2. ASSET_DEFAULT_BROKER[assetClass].primary (if legally allowed)
 *   3. ASSET_DEFAULT_BROKER[assetClass].fallback
 */
export function selectBroker(args: {
  assetClass: AssetClass
  userOverride?: Broker
  userJurisdiction: Jurisdiction
}): SelectBrokerResult {
  const { assetClass, userOverride, userJurisdiction } = args
  const defaults = ASSET_DEFAULT_BROKER[assetClass]

  // 1. User override — honour if jurisdiction allows
  if (userOverride) {
    const cfg = BROKER_CONFIGS[userOverride]
    if (cfg && isBrokerAllowed(userOverride, userJurisdiction)) {
      return { broker: userOverride, reason: 'user_override', config: cfg }
    }
    // Override blocked by jurisdiction — fall through to default
  }

  // 2. Primary default
  if (isBrokerAllowed(defaults.primary, userJurisdiction)) {
    return { broker: defaults.primary, reason: 'default', config: BROKER_CONFIGS[defaults.primary] }
  }

  // 3. Fallback
  return { broker: defaults.fallback, reason: 'fallback_legal', config: BROKER_CONFIGS[defaults.fallback] }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/** Map the legacy asset_class strings used in DB trades to the typed AssetClass enum. */
export function normaliseAssetClass(raw: string): AssetClass {
  const lc = raw.toLowerCase()
  if (lc === 'stock' || lc === 'equity' || lc === 'etf') return 'stocks'
  if (lc === 'crypto' || lc === 'crypto_spot') return 'crypto_spot'
  if (lc === 'crypto_perp' || lc === 'perp' || lc === 'perpetual') return 'crypto_perp'
  if (lc === 'forex' || lc === 'fx' || lc === 'currency') return 'forex'
  if (lc === 'options' || lc === 'option') return 'options'
  if (lc === 'futures' || lc === 'future') return 'futures'
  if (lc === 'polymarket' || lc === 'prediction_market') return 'polymarket'
  return 'stocks' // safe default
}
