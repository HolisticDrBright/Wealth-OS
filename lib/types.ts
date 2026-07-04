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

export interface Order {
  id: string
  user_id: string
  symbol: string
  asset_class: string
  side: 'buy' | 'sell'
  order_type: 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop'
  /** 'skipped' = no broker order was placed (paper phase / capability / jurisdiction block). */
  status: 'pending' | 'submitted' | 'open' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected' | 'expired' | 'skipped'
  quantity?: number
  notional_usd?: number
  limit_price?: number
  stop_price?: number
  trail_amount?: number
  trail_percent?: number
  time_in_force: 'day' | 'gtc' | 'ioc' | 'fok'
  broker?: string
  broker_order_id?: string
  filled_qty: number
  filled_avg_price?: number
  source?: 'manual' | 'copy_trade' | 'rebalance' | 'harvest' | 'rule'
  source_ref_id?: string
  error_message?: string
  submitted_at?: string
  filled_at?: string
  cancelled_at?: string
  created_at: string
  updated_at: string
}

export interface PortfolioTarget {
  id: string
  user_id: string
  asset_class: string
  target_pct: number
  created_at: string
  updated_at: string
}

export interface RebalanceSuggestion {
  id: string
  user_id: string
  symbol?: string
  asset_class: string
  action: 'buy' | 'sell'
  current_pct?: number
  target_pct?: number
  drift_pct?: number
  suggested_notional?: number
  status: 'pending' | 'approved' | 'executed' | 'dismissed'
  executed_at?: string
  created_at: string
}

export interface HarvestCandidate {
  id: string
  user_id: string
  symbol: string
  asset_class: string
  position_id?: string
  unrealized_loss_usd: number
  unrealized_loss_pct: number
  purchase_date?: string
  wash_sale_risk: boolean
  replacement_symbol?: string
  status: 'pending' | 'harvested' | 'dismissed' | 'expired'
  expires_at?: string
  harvested_at?: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface Strategy {
  id: string
  user_id: string
  name: string
  description?: string
  asset_class?: string
  type?: 'momentum' | 'value' | 'copy_trade' | 'manual' | 'rebalance' | 'harvest'
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface StrategyPosition {
  id: string
  strategy_id: string
  user_id: string
  copied_position_id?: string
  symbol: string
  action: string
  entry_price?: number
  exit_price?: number
  quantity?: number
  notional_value?: number
  pnl_usd: number
  pnl_pct: number
  opened_at: string
  closed_at?: string
  status: 'open' | 'closed'
}

export interface AutopilotRule {
  id: string
  user_id: string
  name: string
  is_active: boolean
  priority: number
  condition_symbols?: string[]
  condition_asset_classes?: string[]
  condition_actions?: string[]
  condition_min_notional?: number
  condition_max_notional?: number
  condition_trader_ids?: string[]
  condition_min_trader_return_pct?: number
  condition_min_cio_score?: number
  condition_time_window_start?: string
  condition_time_window_end?: string
  action_type: 'copy' | 'skip' | 'reduce' | 'alert_only'
  action_sizing_pct?: number
  action_sizing_mode?: 'fixed_pct' | 'fixed_usd' | 'proportional'
  action_fixed_usd?: number
  action_max_daily_usd?: number
  action_broker_override?: string
  created_at: string
  updated_at: string
}

export interface RetirementPlan {
  id: string
  user_id: string
  current_age?: number
  target_retirement_age: number
  current_savings_usd: number
  annual_contribution_usd: number
  expected_return_pct: number
  inflation_rate_pct: number
  target_monthly_income_usd?: number
  social_security_monthly_usd: number
  pension_monthly_usd: number
  ira_balance_usd: number
  roth_ira_balance_usd: number
  k401_balance_usd: number
  taxable_balance_usd: number
  projected_retirement_balance_usd?: number
  income_gap_monthly_usd?: number
  on_track?: boolean
  last_computed_at?: string
  claude_advice?: string
  claude_advice_generated_at?: string
  created_at: string
  updated_at: string
}

export interface CryptoPrice {
  id: string
  symbol: string
  pair: string
  price_usd: number
  bid?: number
  ask?: number
  volume_24h?: number
  change_pct_24h?: number
  high_24h?: number
  low_24h?: number
  source: string
  fetched_at: string
}

export interface CryptoPortfolioPosition {
  id: string
  user_id: string
  symbol: string
  balance: number
  balance_usd: number
  avg_cost_usd?: number
  unrealized_pnl_usd: number
  last_synced_at?: string
}

export interface ForexRate {
  id: string
  instrument: string
  bid: number
  ask: number
  spread_pips?: number
  source: string
  fetched_at: string
}

export interface ForexPosition {
  id: string
  user_id: string
  instrument: string
  side: 'long' | 'short'
  units: number
  avg_price?: number
  current_price?: number
  unrealized_pnl: number
  unrealized_pnl_usd: number
  oanda_trade_id?: string
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

// ─── Phase 3 Types ────────────────────────────────────────

export interface MarketplaceListing {
  id: string
  publisher_user_id: string
  trader_id?: string
  title: string
  description?: string
  strategy_type?: string
  asset_classes: string[]
  price_monthly_usd: number
  is_free: boolean
  is_published: boolean
  is_verified: boolean
  subscriber_count: number
  avg_rating?: number
  review_count: number
  total_return_pct?: number
  ytd_return_pct?: number
  sharpe_ratio?: number
  max_drawdown_pct?: number
  win_rate_pct?: number
  trade_count: number
  inception_date?: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface MarketplaceSubscription {
  id: string
  user_id: string
  listing_id: string
  status: 'active' | 'paused' | 'cancelled'
  auto_copy_enabled: boolean
  max_allocation_pct: number
  risk_level: 'conservative' | 'moderate' | 'aggressive'
  subscribed_at: string
  cancelled_at?: string
  listing?: MarketplaceListing
}

export interface MarketplaceReview {
  id: string
  listing_id: string
  reviewer_user_id: string
  rating: number
  title?: string
  body?: string
  is_verified_subscriber: boolean
  helpful_votes: number
  created_at: string
}

export interface BacktestJob {
  id: string
  user_id: string
  strategy_id?: string
  listing_id?: string
  name: string
  description?: string
  symbols: string[]
  asset_class: string
  start_date: string
  end_date: string
  initial_capital_usd: number
  rebalance_frequency: 'none' | 'daily' | 'weekly' | 'monthly'
  benchmark_symbol: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  started_at?: string
  completed_at?: string
  error_message?: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface BacktestResult {
  id: string
  job_id: string
  user_id: string
  total_return_pct?: number
  annualized_return_pct?: number
  benchmark_return_pct?: number
  alpha?: number
  beta?: number
  sharpe_ratio?: number
  sortino_ratio?: number
  max_drawdown_pct?: number
  max_drawdown_duration_days?: number
  win_rate_pct?: number
  profit_factor?: number
  total_trades: number
  winning_trades: number
  losing_trades: number
  avg_win_usd?: number
  avg_loss_usd?: number
  final_portfolio_value_usd?: number
  equity_curve: Array<{ date: string; value: number; benchmark?: number }>
  monthly_returns: Record<string, number>
  trade_log: BacktestTrade[]
  created_at: string
}

export interface BacktestTrade {
  date: string
  symbol: string
  action: 'buy' | 'sell'
  quantity: number
  price: number
  notional: number
  pnl?: number
}

export interface Household {
  id: string
  name: string
  owner_user_id: string
  household_type: 'family' | 'couple' | 'individual' | 'trust' | 'foundation' | 'advisory'
  total_net_worth_usd: number
  advisor_user_id?: string
  estate_plan_notes?: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  members?: HouseholdMember[]
  goals?: HouseholdGoal[]
}

export interface HouseholdMember {
  id: string
  household_id: string
  user_id?: string
  name: string
  role: 'owner' | 'spouse' | 'dependent' | 'trustee' | 'beneficiary' | 'advisor'
  email?: string
  birth_year?: number
  net_worth_usd: number
  income_usd: number
  is_invited: boolean
  joined_at?: string
  created_at: string
}

export interface HouseholdGoal {
  id: string
  household_id: string
  name: string
  goal_type: 'retirement' | 'education' | 'home' | 'estate' | 'trust' | 'charitable' | 'emergency' | 'other' | 'general'
  target_amount_usd: number
  current_amount_usd: number
  target_date?: string
  assigned_sleeve_id?: string
  status: 'active' | 'achieved' | 'paused' | 'cancelled'
  notes?: string
  created_at: string
  updated_at: string
}

export interface AdvisorClient {
  id: string
  advisor_user_id: string
  client_user_id?: string
  household_id?: string
  client_name: string
  client_email?: string
  aum_usd: number
  fee_type: 'percentage' | 'flat' | 'hybrid'
  fee_pct?: number
  fee_flat_annual_usd?: number
  status: 'active' | 'prospect' | 'inactive'
  notes?: string
  onboarded_at?: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface PortfolioSleeve {
  id: string
  user_id: string
  household_id?: string
  name: string
  description?: string
  sleeve_type: 'autonomous' | 'manual' | 'advisor_managed' | 'trust'
  target_allocation_pct?: number
  current_value_usd: number
  inception_date?: string
  benchmark_symbol?: string
  is_active: boolean
  approval_required: boolean
  approval_threshold_usd: number
  approved_strategies: string[]
  approved_asset_classes: string[]
  max_position_pct: number
  max_drawdown_pct: number
  halt_on_breach: boolean
  halted: boolean
  halted_reason?: string
  performance_ytd_pct?: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  positions?: SleevePosition[]
  pending_approvals?: SleeveApprovalRequest[]
}

export interface SleeveApprovalRequest {
  id: string
  sleeve_id: string
  user_id: string
  request_type: 'trade' | 'rebalance' | 'parameter_change' | 'halt' | 'resume'
  symbol?: string
  action?: string
  notional_usd?: number
  order_type?: string
  reason?: string
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  reviewed_by?: string
  reviewed_at?: string
  review_notes?: string
  expires_at: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface SleevePosition {
  id: string
  sleeve_id: string
  user_id: string
  symbol: string
  asset_class: string
  quantity: number
  avg_cost_usd?: number
  current_price_usd?: number
  market_value_usd: number
  unrealized_pnl_usd: number
  unrealized_pnl_pct: number
  weight_pct?: number
  last_updated_at: string
  created_at: string
}
