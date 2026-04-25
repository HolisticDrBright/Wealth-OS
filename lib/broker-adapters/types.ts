export interface OrderParams {
  symbol: string
  asset_class: string
  side: 'buy' | 'sell'
  order_type?: 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop'
  notional_usd?: number
  quantity?: number
  limit_price?: number
  stop_price?: number
  trail_amount?: number
  trail_percent?: number
  time_in_force?: 'day' | 'gtc' | 'ioc' | 'fok'
  broker_override?: string
  /** ISO-3166-1 alpha-2 country code of the user's jurisdiction */
  jurisdiction?: string
}

export interface BrokerResult {
  status: 'open' | 'submitted' | 'skipped' | 'failed'
  broker?: string
  broker_order_id?: string
  error?: string
  reason?: string
}

export interface BrokerConfig {
  id: string
  displayName: string
  /** Asset classes this broker handles */
  assetClasses: string[]
  /** Countries where this broker is NOT available */
  blockedJurisdictions?: string[]
  /** Env vars required for this broker to be considered "configured" */
  requiredEnvVars: string[]
}

/** Abstract base class — all concrete adapters extend this. */
export abstract class BrokerAdapter {
  abstract readonly config: BrokerConfig

  /** Returns true if all required env vars are set. */
  isConfigured(): boolean {
    return this.config.requiredEnvVars.every(v => !!process.env[v])
  }

  /** Returns true if jurisdiction is allowed (or no restriction set). */
  isAllowedJurisdiction(jurisdiction?: string): boolean {
    if (!jurisdiction || !this.config.blockedJurisdictions?.length) return true
    return !this.config.blockedJurisdictions.includes(jurisdiction.toUpperCase())
  }

  abstract execute(params: OrderParams): Promise<BrokerResult>
}
