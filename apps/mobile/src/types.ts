// Shared types — mirrors /lib/types.ts in the web app
// TODO: extract to a shared packages/types workspace when converting to monorepo

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

export interface Trader {
  id: string
  name: string
  handle: string
  asset_class: 'stock' | 'crypto' | 'forex' | 'polymarket'
  total_return_pct: number
  win_rate_pct: number
  followers_count: number
  verified: boolean
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
  traders?: { name: string; handle: string }
}

export interface Alert {
  id: string
  user_id: string
  type: 'trade_executed' | 'risk_breach' | 'price_alert' | 'simulation_done' | 'opportunity' | 'system'
  title: string
  body?: string
  severity: 'info' | 'warning' | 'critical'
  is_read: boolean
  created_at: string
}

export interface UserCopiedPosition {
  id: string
  symbol: string
  asset_class: string
  action: string
  notional_value: number
  pnl_usd: number
  pnl_pct: number
  status: 'pending' | 'open' | 'closed' | 'failed'
  opened_at: string
}
