/**
 * TypeScript mirror of Meta_Poly_tarder wire types.
 *
 * All fields use snake_case to match the JSON wire format exactly.
 * Use the adapter helpers at the bottom to convert to camelCase in the app.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export type SignalStrategy =
  | 'entropy'
  | 'avellaneda'
  | 'arb'
  | 'binance_arb'
  | 'ensemble_ai'
  | 'jet'
  | 'copy'
  | 'theta'
  | 'manual'
  | 'correlation_arb'

export type Side = 'YES' | 'NO'

export type EdgeStrength = 'strong' | 'moderate' | 'weak' | 'none'

export type EntropyAction = 'BUY_YES' | 'BUY_NO' | 'HOLD'

export type WalletTier = 'legendary' | 'elite' | 'pro' | 'rising'

export type SmartMoneyBias = 'bullish' | 'bearish' | 'neutral'

// ─── Market ───────────────────────────────────────────────────────────────────

/** Wire shape from GET /api/markets and GET /api/markets/{id} */
export interface Market {
  id: string
  condition_id: string
  question: string
  category: string
  yes_price: number
  no_price: number
  liquidity: number
  volume_24h: number
  end_date: string | null       // ISO8601 or null
  spread: number
  entropy_bits: number          // 0 until quant modules run
  best_bid: number
  best_ask: number
  arb_edge: number              // 1 - yes - no; positive = arb opportunity
  model_probability: number     // 0 until ensemble runs
  kl_divergence: number         // 0 until ensemble runs
  // detail endpoint only
  volume?: number
}

/** Entropy-scored market from GET /api/entropy/top */
export interface EntropyMarket {
  id: string
  question: string
  category: string
  market_price: number
  model_probability: number
  entropy_bits: number
  kl_divergence: number
  kelly_fraction: number
  quarter_kelly: number
  edge: number
  edge_strength: EdgeStrength
  action: EntropyAction
  liquidity: number
  volume_24h: number
}

// ─── Signals ──────────────────────────────────────────────────────────────────

/** Wire shape from GET /api/signals */
export interface Signal {
  id: string                    // "{strategy}-{market_id[:8]}-{ts}"
  strategy: SignalStrategy
  market_id: string
  question: string
  side: Side
  price: number
  size_usdc: number
  confidence: number            // 0–1
  reason: string
  kl_divergence: number
  kelly_fraction: number
  confluence_count: number
  timestamp: string             // ISO8601
}

export interface SignalsResponse {
  signals: Signal[]
  count: number
}

// ─── Portfolio ────────────────────────────────────────────────────────────────

/** Wire shape from GET /api/portfolio/positions items */
export interface PortfolioPosition {
  id: number
  market_id: string
  question: string
  side: Side
  entry_price: number
  size_usdc: number
  current_price: number
  strategy: SignalStrategy | 'clob'
  opened_at: string             // ISO8601
  pnl: number
  pnl_pct: number
  hours_to_close: number | null
  source?: 'clob_api'           // present only on merged CLOB positions
}

export interface PositionsResponse {
  positions: PortfolioPosition[]
  total_pnl: number
}

/** Wire shape from GET /api/portfolio/stats */
export interface PortfolioStats {
  balance: number
  starting_capital: number
  total_exposure: number
  unrealized_pnl: number
  realized_pnl: number
  win_rate: number
  sharpe_ratio: number
  max_drawdown: number
  trades_today: number
  paper_trading: boolean
  markets_count: number
  positions_count: number
  pending_signals: number
  scheduler_running: boolean
  clob_balance?: number         // only when CLOB auth configured
}

/** Wire shape from GET /api/portfolio/trade-log items */
export interface TradeLogEntry {
  ts: string
  market_id: string
  question: string
  side: Side
  price: number
  size_usdc: number
  strategy: SignalStrategy | 'clob'
  paper: boolean
  pnl: number
  trade_type: 'open' | 'close'
  exit_reason: string
}

export interface TradeLogResponse {
  trades: TradeLogEntry[]
  count: number
}

/** Wire shape from GET /api/portfolio/trade-stats */
export interface TradeStats {
  total_trades: number
  wins: number
  losses: number
  breakeven: number
  total_pnl: number
  gross_profit: number
  gross_loss: number
  avg_pnl: number
  best_trade: number
  worst_trade: number
  win_rate: number
  resolved_trades: number
  breakeven_trades: number
  profit_factor: number | null
}

// ─── Whale / Copy ─────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number
  address: string
  display_name: string
  pnl: number
  volume: number
  markets_traded: number
  win_rate: number
  tier: WalletTier
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[]
}

/** Whale trade event — raw dict from system_state.whale_trades */
export interface WhaleEvent {
  market_id: string
  question: string
  side: Side
  size_usdc: number
  price: number
  wallet: string
  display_name?: string
  tier?: WalletTier
  timestamp: string
}

export interface SmartMoneyIndexResponse {
  smi: number
  bias: SmartMoneyBias
}

// ─── Jet Tracker ──────────────────────────────────────────────────────────────

/** Jet signal — raw dict from system_state.jet_signals */
export interface JetSignal {
  market_id: string
  question: string
  side: Side
  confidence: number
  reason: string
  tail_number?: string
  subject?: string
  timestamp: string
}

/** Flight state — raw dict from system_state.jet_flights */
export interface JetFlight {
  tail_number: string
  subject?: string
  origin?: string
  destination?: string
  altitude?: number
  speed?: number
  timestamp: string
}

// ─── Health ───────────────────────────────────────────────────────────────────

export interface VPNStatus {
  healthy: boolean
  ip: string
  country: string
  error: string
}

export interface HealthResponse {
  status: 'ok' | 'degraded'
  balance: number
  starting_capital: number
  total_exposure: number
  unrealized_pnl: number
  realized_pnl: number
  win_rate: number
  sharpe_ratio: number
  max_drawdown: number
  trades_today: number
  paper_trading: boolean
  markets_count: number
  positions_count: number
  pending_signals: number
  scheduler_running: boolean
  vpn?: VPNStatus
}

// ─── Strategy flags ───────────────────────────────────────────────────────────

export interface StrategyFlags {
  entropy: boolean
  avellaneda: boolean
  arb: boolean
  binance_arb: boolean
  ensemble: boolean
  jet: boolean
  copy: boolean
  theta: boolean
}

/** Wire shape from GET /api/settings */
export interface SettingsResponse {
  max_trade_size_usdc: number
  max_single_market_pct: number
  max_portfolio_exposure: number
  max_daily_loss_pct: number
  stop_loss_pct: number
  take_profit_pct: number
  trailing_stop_pct: number
  edge_capture_pct: number
  age_hours_full_target: number
  age_hours_min_target: number
  min_profit_to_exit: number
  max_age_hours: number
  avellaneda_enabled: boolean
  entropy_enabled: boolean
  theta_enabled: boolean
  ensemble_enabled: boolean
  binance_arb_enabled: boolean
  paper_trading: boolean
}

// ─── Live-gate error shape ────────────────────────────────────────────────────

export interface LiveDisabledError {
  success: false
  code: 'LIVE_DISABLED'
  message: string
}

export interface ApiError {
  success: false
  code: string
  message: string
}

// ─── camelCase adapter types (used inside the app, not on the wire) ───────────

export interface MarketApp {
  id: string
  conditionId: string
  question: string
  category: string
  yesPrice: number
  noPrice: number
  liquidity: number
  volume24h: number
  endDate: string | null
  spread: number
  entropyBits: number
  bestBid: number
  bestAsk: number
  arbEdge: number
  modelProbability: number
  klDivergence: number
}

export interface SignalApp {
  id: string
  strategy: SignalStrategy
  marketId: string
  question: string
  side: Side
  price: number
  sizeUsdc: number
  confidence: number
  reason: string
  klDivergence: number
  kellyFraction: number
  confluenceCount: number
  timestamp: string
}

export interface PortfolioPositionApp {
  id: number
  marketId: string
  question: string
  side: Side
  entryPrice: number
  sizeUsdc: number
  currentPrice: number
  strategy: SignalStrategy | 'clob'
  openedAt: string
  pnl: number
  pnlPct: number
  hoursToClose: number | null
}

// ─── Adapter helpers ──────────────────────────────────────────────────────────

export function toMarketApp(m: Market): MarketApp {
  return {
    id: m.id,
    conditionId: m.condition_id,
    question: m.question,
    category: m.category,
    yesPrice: m.yes_price,
    noPrice: m.no_price,
    liquidity: m.liquidity,
    volume24h: m.volume_24h,
    endDate: m.end_date,
    spread: m.spread,
    entropyBits: m.entropy_bits,
    bestBid: m.best_bid,
    bestAsk: m.best_ask,
    arbEdge: m.arb_edge,
    modelProbability: m.model_probability,
    klDivergence: m.kl_divergence,
  }
}

export function toSignalApp(s: Signal): SignalApp {
  return {
    id: s.id,
    strategy: s.strategy,
    marketId: s.market_id,
    question: s.question,
    side: s.side,
    price: s.price,
    sizeUsdc: s.size_usdc,
    confidence: s.confidence,
    reason: s.reason,
    klDivergence: s.kl_divergence,
    kellyFraction: s.kelly_fraction,
    confluenceCount: s.confluence_count,
    timestamp: s.timestamp,
  }
}

export function toPositionApp(p: PortfolioPosition): PortfolioPositionApp {
  return {
    id: p.id,
    marketId: p.market_id,
    question: p.question,
    side: p.side,
    entryPrice: p.entry_price,
    sizeUsdc: p.size_usdc,
    currentPrice: p.current_price,
    strategy: p.strategy,
    openedAt: p.opened_at,
    pnl: p.pnl,
    pnlPct: p.pnl_pct,
    hoursToClose: p.hours_to_close,
  }
}
