export interface User {
  id: string
  email: string
  full_name?: string
  avatar_url?: string
}

export interface NetWorthEntry {
  id: string
  user_id: string
  date: string
  total_assets: number
  total_liabilities: number
  net_worth: number
}

export interface Asset {
  id: string
  user_id: string
  name: string
  category: 'stock' | 'crypto' | 'real_estate' | 'cash' | 'bond' | 'other'
  symbol?: string
  quantity?: number
  current_value: number
  purchase_price?: number
  purchase_date?: string
  notes?: string
}

export interface Transaction {
  id: string
  user_id: string
  date: string
  description: string
  amount: number
  category: string
  type: 'income' | 'expense'
  account?: string
}

export interface Budget {
  id: string
  user_id: string
  category: string
  monthly_limit: number
  spent: number
  month: string
}

export interface Goal {
  id: string
  user_id: string
  name: string
  target_amount: number
  current_amount: number
  target_date: string
  category: 'retirement' | 'home' | 'education' | 'emergency' | 'vacation' | 'other'
  notes?: string
}

export interface Trader {
  id: string
  name: string
  handle: string
  asset_class: 'stock' | 'crypto' | 'forex' | 'polymarket'
  source: 'unusual_whales' | 'quiver_quant' | 'nansen' | 'arkham' | 'myfxbook' | 'polymarket' | 'manual'
  avatar_url?: string
  bio?: string
  total_return_pct: number
  ytd_return_pct: number
  win_rate_pct: number
  avg_trade_size_usd: number
  trade_count: number
  followers_count: number
  verified: boolean
  is_active: boolean
  metadata: Record<string, unknown>
  last_synced_at?: string
  // joined from user_followed_traders
  follow_settings?: UserFollowedTrader | null
}

export interface TraderTrade {
  id: string
  trader_id: string
  asset_class: string
  symbol: string
  action: 'buy' | 'sell' | 'short' | 'cover'
  quantity?: number
  price?: number
  notional_value?: number
  trade_date: string
  metadata: Record<string, unknown>
}

export interface UserFollowedTrader {
  id: string
  user_id: string
  trader_id: string
  auto_copy_enabled: boolean
  max_allocation_pct_per_trade: number
  copy_asset_classes: string[]
  risk_level: 'conservative' | 'moderate' | 'aggressive'
  max_daily_copy_usd?: number
}

export interface UserCopiedPosition {
  id: string
  user_id: string
  trader_id: string
  symbol: string
  asset_class: string
  action: string
  quantity?: number
  entry_price?: number
  current_price?: number
  notional_value: number
  pnl_usd: number
  pnl_pct: number
  status: 'pending' | 'open' | 'closed' | 'failed'
  broker?: string
  error_message?: string
  opened_at: string
  closed_at?: string
  // joined
  trader?: Pick<Trader, 'name' | 'handle' | 'asset_class'>
}

export interface RiskControl {
  id: string
  user_id: string
  max_portfolio_risk_pct: number
  max_single_position_pct: number
  max_drawdown_pct: number
  stop_loss_enabled: boolean
  daily_loss_limit_usd?: number
  volatility_threshold: 'low' | 'medium' | 'high'
  created_at: string
  updated_at: string
}

export interface SimulationJob {
  id: string
  user_id: string
  title: string
  description?: string
  asset_class?: string
  symbols?: string[]
  scenario: 'bull' | 'bear' | 'base' | 'stress' | 'montecarlo'
  horizon_days: number
  num_simulations: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  started_at?: string
  completed_at?: string
  created_at: string
}

export interface SimulationReport {
  id: string
  job_id: string
  user_id: string
  bull_probability?: number
  bear_probability?: number
  consensus_direction?: 'bullish' | 'bearish' | 'neutral'
  tail_risk_score?: number
  confidence_level?: 'high' | 'medium' | 'low'
  agent_consensus?: number
  key_findings?: string[]
  scenario_summary?: string
  raw_output?: Record<string, unknown>
  created_at: string
}

export interface Opportunity {
  id: string
  user_id?: string
  source: 'cio' | 'screener' | 'trader_signal' | 'manual'
  symbol?: string
  asset_class?: string
  title: string
  description?: string
  action?: 'buy' | 'sell' | 'watch'
  confidence?: 'high' | 'medium' | 'low'
  score?: number
  expires_at?: string
  is_read: boolean
  metadata: Record<string, unknown>
  created_at: string
}

export interface Alert {
  id: string
  user_id: string
  type: 'trade_executed' | 'risk_breach' | 'price_alert' | 'simulation_done' | 'opportunity' | 'system'
  title: string
  body?: string
  severity: 'info' | 'warning' | 'critical'
  is_read: boolean
  action_url?: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface LinkedAccount {
  id: string
  user_id: string
  provider: 'alpaca' | 'kraken' | 'oanda' | 'polymarket' | 'plaid' | 'manual'
  account_name?: string
  account_id_external?: string
  status: 'active' | 'disconnected' | 'error'
  balance_usd?: number
  currency: string
  is_paper_trading: boolean
  metadata: Record<string, unknown>
  last_synced_at?: string
  created_at: string
  updated_at: string
}

export interface TaxStrategy {
  id: string
  title: string
  description: string
  potential_savings: number
  category: 'deduction' | 'credit' | 'account' | 'investment' | 'timing'
  priority: 'high' | 'medium' | 'low'
  action_items: string[]
}
