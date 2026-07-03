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
  /**
   * Deterministic idempotency key (wos-<sha256(opportunityId:leg)[0:20]>).
   * Retries and concurrent workers MUST reuse the same id so the broker
   * dedupes. Set by lib/broker-adapters/order-intents.ts.
   */
  client_order_id?: string
}

/**
 * Bracket (OCO) order parameters. Places an entry order with attached
 * stop-loss and/or take-profit child orders in a single broker call.
 * Adapters that lack native bracket support place legs separately.
 */
export interface BracketParams {
  symbol: string
  asset_class: string
  /** Direction of the ENTRY leg. */
  side: 'buy' | 'sell'
  quantity?: number
  notional_usd?: number
  /** Entry limit price; omit for market entry. */
  limit_price?: number
  /** Absolute stop-loss price (takes precedence over stop_pct). */
  stop_price?: number
  /** Stop-loss as fraction of entry price (e.g. 0.08 = 8% below for long). */
  stop_pct?: number
  /** Absolute take-profit limit price (takes precedence over target_pct). */
  take_profit_price?: number
  /** Take-profit as fraction above entry (e.g. 0.10 = 10% above for long). */
  target_pct?: number
  /** Trailing stop as % of price (mutually exclusive with stop_price/stop_pct). */
  trail_pct?: number
  time_in_force?: 'day' | 'gtc'
  jurisdiction?: string
  /** Deterministic idempotency key for the ENTRY leg (see OrderParams). */
  client_order_id?: string
}

export interface BracketResult {
  status: 'submitted' | 'skipped' | 'failed'
  broker: string
  /** Broker ID of the entry/parent order. */
  parent_order_id?: string
  /** Broker ID of the stop-loss child order. */
  stop_order_id?: string
  /** Broker ID of the take-profit child order. */
  take_profit_order_id?: string
  error?: string
  reason?: string
}

export interface BrokerResult {
  status: 'open' | 'submitted' | 'skipped' | 'failed'
  broker?: string
  broker_order_id?: string
  error?: string
  reason?: string
}

/**
 * Honest capability declaration per adapter. Execution refuses orders that
 * rely on a capability the adapter does not really have, instead of guessing
 * (e.g. deriving instrument units from USD notional).
 */
export interface BrokerCapabilities {
  /** Can place market orders. */
  supportsMarket: boolean
  /** Can place limit orders. */
  supportsLimit: boolean
  /** Can place bracket orders (entry + protective stop/take-profit). */
  supportsBracket: boolean
  /** Can cancel a previously placed order. */
  supportsCancel: boolean
  /** Can query order status / fills. */
  supportsStatus: boolean
  /** Accepts USD-notional sizing natively (no client-side unit conversion). */
  supportsNotionalSizing: boolean
  /** Accepts explicit quantity / units / contracts sizing. */
  supportsQuantitySizing: boolean
  /**
   * True ONLY after the adapter has been verified against the broker's real
   * sandbox/paper environment. Live routing requires liveReady=true — during
   * the paper validation phase every adapter is false.
   */
  liveReady: boolean
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
  /** What this adapter can really do — enforced before execution. */
  capabilities: BrokerCapabilities
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

  /**
   * Returns a human-readable reason when the order relies on a capability
   * this adapter does not have, or null when the order is supported.
   */
  checkOrderSupport(params: OrderParams): string | null {
    const c = this.config.capabilities
    const id = this.config.id
    const type = params.order_type ?? 'market'
    if (type === 'market' && !c.supportsMarket) return `${id} does not support market orders`
    if (type === 'limit' && !c.supportsLimit) return `${id} does not support limit orders`
    if (params.quantity == null && params.notional_usd == null) {
      return `order must specify quantity or notional_usd`
    }
    if (params.quantity == null && params.notional_usd != null && !c.supportsNotionalSizing) {
      return `${id} does not accept USD-notional sizing — pass an explicit quantity in instrument units`
    }
    if (params.quantity != null && !c.supportsQuantitySizing) {
      return `${id} does not accept quantity sizing — pass notional_usd`
    }
    return null
  }

  abstract execute(params: OrderParams): Promise<BrokerResult>

  /**
   * Place a bracket (entry + stop + take-profit) as a single atomic operation
   * where the broker supports it. Falls back to separate orders otherwise.
   * Default: returns skipped — override in adapters that support brackets.
   */
  async placeBracketOrder(params: BracketParams): Promise<BracketResult> {
    // Fallback: place entry + stop as separate orders; no atomic OCO guarantee.
    const entry = await this.execute({
      symbol: params.symbol,
      asset_class: params.asset_class,
      side: params.side,
      notional_usd: params.notional_usd,
      quantity: params.quantity,
      limit_price: params.limit_price,
      order_type: params.limit_price ? 'limit' : 'market',
      time_in_force: params.time_in_force ?? 'gtc',
    })
    if (entry.status === 'failed') {
      return { status: 'failed', broker: this.config.id, error: entry.error }
    }
    let stopOrderId: string | undefined
    if (params.stop_price || params.stop_pct) {
      const stop = await this.execute({
        symbol: params.symbol,
        asset_class: params.asset_class,
        side: params.side === 'buy' ? 'sell' : 'buy',
        quantity: params.quantity,
        notional_usd: params.notional_usd,
        stop_price: params.stop_price,
        order_type: 'stop',
        time_in_force: 'gtc',
      })
      stopOrderId = stop.broker_order_id
    }
    return {
      status: entry.status === 'open' || entry.status === 'submitted' ? 'submitted' : 'skipped',
      broker: this.config.id,
      parent_order_id: entry.broker_order_id,
      stop_order_id: stopOrderId,
    }
  }

  /** Cancel all legs of a bracket order by parent order ID. */
  async cancelBracket(parentOrderId: string): Promise<BrokerResult> {
    return { status: 'skipped', broker: this.config.id, reason: `cancelBracket not implemented for ${this.config.id}; cancel order ${parentOrderId} manually` }
  }

  /** Move an existing stop-loss order to a new price. */
  async modifyStop(orderId: string, _newStop: number): Promise<BrokerResult> {
    return { status: 'skipped', broker: this.config.id, reason: `modifyStop not implemented for ${this.config.id}; order ${orderId}` }
  }

  /** Move an existing take-profit limit order to a new price. */
  async modifyTarget(orderId: string, _newTarget: number): Promise<BrokerResult> {
    return { status: 'skipped', broker: this.config.id, reason: `modifyTarget not implemented for ${this.config.id}; order ${orderId}` }
  }
}
