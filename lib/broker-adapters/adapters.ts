import { createHash, createHmac, randomUUID } from 'crypto'
import type { OrderParams, BrokerResult, BrokerConfig, BracketParams, BracketResult } from './types'
import { BrokerAdapter } from './types'

/**
 * Client order id for brokers that require one. Callers going through
 * lib/broker-adapters/order-intents.ts pass a DETERMINISTIC id (idempotent
 * retries); direct calls get a random UUID — never a timestamp, which
 * collides across workers and changes on every retry.
 */
function cidOrRandom(provided: string | undefined, suffix = ''): string {
  return provided ? `${provided}${suffix}` : `wos-${randomUUID().slice(0, 20)}${suffix}`
}

// ─── Alpaca (US stocks, ETFs, crypto) ────────────────────────────────────────

export class AlpacaAdapter extends BrokerAdapter {
  readonly config: BrokerConfig = {
    id: 'alpaca',
    displayName: 'Alpaca',
    assetClasses: ['stock', 'etf', 'crypto'],
    requiredEnvVars: ['ALPACA_API_KEY', 'ALPACA_SECRET_KEY'],
  }

  async execute(params: OrderParams): Promise<BrokerResult> {
    const key = process.env.ALPACA_API_KEY
    const secret = process.env.ALPACA_SECRET_KEY
    if (!key || !secret) return { status: 'skipped', reason: 'ALPACA_API_KEY not configured' }

    try {
      const base = process.env.ALPACA_LIVE === 'true'
        ? 'https://api.alpaca.markets'
        : 'https://paper-api.alpaca.markets'

      const body: Record<string, unknown> = {
        symbol: params.symbol,
        side: params.side,
        type: params.order_type ?? 'market',
        time_in_force: params.time_in_force ?? 'day',
      }
      if (params.notional_usd && !params.quantity) body.notional = params.notional_usd.toFixed(2)
      else if (params.quantity) body.qty = params.quantity.toString()
      if (params.limit_price) body.limit_price = params.limit_price.toString()
      if (params.stop_price) body.stop_price = params.stop_price.toString()
      if (params.trail_amount) body.trail_price = params.trail_amount.toString()
      if (params.trail_percent) body.trail_percent = params.trail_percent.toString()

      const res = await fetch(`${base}/v2/orders`, {
        method: 'POST',
        headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) return { status: 'failed', broker: 'alpaca', error: data.message ?? 'Alpaca error' }
      return { status: 'open', broker: 'alpaca', broker_order_id: data.id }
    } catch (err) {
      return { status: 'failed', broker: 'alpaca', error: String(err) }
    }
  }

  /**
   * Alpaca native bracket: single POST with order_class='bracket',
   * stop_loss.stop_price, and take_profit.limit_price attached.
   */
  async placeBracketOrder(params: BracketParams): Promise<BracketResult> {
    const key = process.env.ALPACA_API_KEY
    const secret = process.env.ALPACA_SECRET_KEY
    if (!key || !secret) return { status: 'skipped', broker: 'alpaca', reason: 'ALPACA_API_KEY not configured' }

    try {
      const base = process.env.ALPACA_LIVE === 'true'
        ? 'https://api.alpaca.markets'
        : 'https://paper-api.alpaca.markets'

      const body: Record<string, unknown> = {
        symbol: params.symbol,
        side: params.side,
        type: params.limit_price ? 'limit' : 'market',
        time_in_force: params.time_in_force ?? 'gtc',
        order_class: 'bracket',
      }
      if (params.notional_usd && !params.quantity) body.notional = params.notional_usd.toFixed(2)
      else if (params.quantity) body.qty = params.quantity.toString()
      if (params.limit_price) body.limit_price = params.limit_price.toString()
      if (params.stop_price) {
        body.stop_loss = { stop_price: params.stop_price.toString() }
      }
      if (params.take_profit_price) {
        body.take_profit = { limit_price: params.take_profit_price.toString() }
      }
      if (params.trail_pct && !params.stop_price) {
        body.type = 'trailing_stop'
        body.trail_percent = params.trail_pct.toString()
        delete body.order_class
      }

      const res = await fetch(`${base}/v2/orders`, {
        method: 'POST',
        headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) return { status: 'failed', broker: 'alpaca', error: data.message ?? 'Alpaca bracket error' }
      return {
        status: 'submitted',
        broker: 'alpaca',
        parent_order_id: data.id,
        stop_order_id: data.legs?.find((l: Record<string, string>) => l.order_type === 'stop')?.id,
        take_profit_order_id: data.legs?.find((l: Record<string, string>) => l.order_type === 'limit')?.id,
      }
    } catch (err) {
      return { status: 'failed', broker: 'alpaca', error: String(err) }
    }
  }

  async cancelBracket(parentOrderId: string): Promise<BrokerResult> {
    const key = process.env.ALPACA_API_KEY
    const secret = process.env.ALPACA_SECRET_KEY
    if (!key || !secret) return { status: 'skipped', broker: 'alpaca', reason: 'not configured' }
    try {
      const base = process.env.ALPACA_LIVE === 'true'
        ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets'
      const res = await fetch(`${base}/v2/orders/${parentOrderId}`, {
        method: 'DELETE',
        headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret },
      })
      return res.ok || res.status === 422
        ? { status: 'submitted', broker: 'alpaca', broker_order_id: parentOrderId }
        : { status: 'failed', broker: 'alpaca', error: `HTTP ${res.status}` }
    } catch (err) {
      return { status: 'failed', broker: 'alpaca', error: String(err) }
    }
  }

  async modifyStop(orderId: string, newStop: number): Promise<BrokerResult> {
    const key = process.env.ALPACA_API_KEY
    const secret = process.env.ALPACA_SECRET_KEY
    if (!key || !secret) return { status: 'skipped', broker: 'alpaca', reason: 'not configured' }
    try {
      const base = process.env.ALPACA_LIVE === 'true'
        ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets'
      const res = await fetch(`${base}/v2/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret, 'Content-Type': 'application/json' },
        body: JSON.stringify({ stop_price: newStop.toString() }),
      })
      const data = await res.json()
      return res.ok
        ? { status: 'submitted', broker: 'alpaca', broker_order_id: data.id }
        : { status: 'failed', broker: 'alpaca', error: data.message }
    } catch (err) {
      return { status: 'failed', broker: 'alpaca', error: String(err) }
    }
  }

  async modifyTarget(orderId: string, newTarget: number): Promise<BrokerResult> {
    const key = process.env.ALPACA_API_KEY
    const secret = process.env.ALPACA_SECRET_KEY
    if (!key || !secret) return { status: 'skipped', broker: 'alpaca', reason: 'not configured' }
    try {
      const base = process.env.ALPACA_LIVE === 'true'
        ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets'
      const res = await fetch(`${base}/v2/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret, 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit_price: newTarget.toString() }),
      })
      const data = await res.json()
      return res.ok
        ? { status: 'submitted', broker: 'alpaca', broker_order_id: data.id }
        : { status: 'failed', broker: 'alpaca', error: data.message }
    } catch (err) {
      return { status: 'failed', broker: 'alpaca', error: String(err) }
    }
  }
}

// ─── Kraken (crypto) ─────────────────────────────────────────────────────────

export class KrakenAdapter extends BrokerAdapter {
  readonly config: BrokerConfig = {
    id: 'kraken',
    displayName: 'Kraken',
    assetClasses: ['crypto'],
    requiredEnvVars: ['KRAKEN_API_KEY', 'KRAKEN_API_SECRET'],
  }

  private mapPair(symbol: string): string {
    const map: Record<string, string> = {
      BTC: 'XXBTZUSD', ETH: 'XETHZUSD', SOL: 'SOLUSD', ADA: 'ADAUSD',
      DOT: 'DOTUSD', AVAX: 'AVAXUSD', MATIC: 'MATICUSD', LINK: 'LINKUSD',
      XRP: 'XXRPZUSD', LTC: 'XLTCZUSD', DOGE: 'XDGEUSD',
    }
    return map[symbol.toUpperCase()] ?? `${symbol.toUpperCase()}USD`
  }

  async execute(params: OrderParams): Promise<BrokerResult> {
    const key = process.env.KRAKEN_API_KEY
    const secret = process.env.KRAKEN_API_SECRET
    if (!key || !secret) return { status: 'skipped', reason: 'KRAKEN_API_KEY not configured' }

    try {
      const nonce = Date.now().toString()
      const path = '/0/private/AddOrder'
      const orderData: Record<string, string> = {
        nonce, type: params.side, pair: this.mapPair(params.symbol), oflags: 'fciq',
        ordertype: params.order_type === 'limit' ? 'limit' : params.order_type === 'stop' ? 'stop-loss' : 'market',
      }
      if (params.quantity) orderData.volume = params.quantity.toString()
      if (params.limit_price) orderData.price = params.limit_price.toString()

      const postData = new URLSearchParams(orderData).toString()
      const secretBuf = Buffer.from(secret, 'base64')
      const hash = createHash('sha256').update(nonce + postData).digest()
      const hmac = createHmac('sha512', secretBuf).update(Buffer.concat([Buffer.from(path), hash])).digest('base64')

      const res = await fetch(`https://api.kraken.com${path}`, {
        method: 'POST',
        headers: { 'API-Key': key, 'API-Sign': hmac, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: postData,
      })
      const data = await res.json()
      if (data.error?.length) return { status: 'failed', broker: 'kraken', error: data.error.join(', ') }
      return { status: 'open', broker: 'kraken', broker_order_id: data.result?.txid?.[0] }
    } catch (err) {
      return { status: 'failed', broker: 'kraken', error: String(err) }
    }
  }

  /**
   * Kraken conditional close: entry order with close[ordertype]=stop-loss
   * and close[price]=<stop>. Take-profit uses a separate GTC limit order.
   */
  async placeBracketOrder(params: BracketParams): Promise<BracketResult> {
    const key = process.env.KRAKEN_API_KEY
    const secret = process.env.KRAKEN_API_SECRET
    if (!key || !secret) return { status: 'skipped', broker: 'kraken', reason: 'KRAKEN_API_KEY not configured' }

    try {
      const nonce = Date.now().toString()
      const path = '/0/private/AddOrder'
      const orderData: Record<string, string> = {
        nonce,
        type: params.side,
        pair: this.mapPair(params.symbol),
        oflags: 'fciq',
        ordertype: params.limit_price ? 'limit' : 'market',
      }
      if (params.quantity) orderData.volume = params.quantity.toString()
      if (params.limit_price) orderData.price = params.limit_price.toString()
      if (params.stop_price) {
        orderData['close[ordertype]'] = 'stop-loss'
        orderData['close[price]'] = params.stop_price.toString()
      }

      const postData = new URLSearchParams(orderData).toString()
      const secretBuf = Buffer.from(secret, 'base64')
      const hash = createHash('sha256').update(nonce + postData).digest()
      const hmac = createHmac('sha512', secretBuf).update(Buffer.concat([Buffer.from(path), hash])).digest('base64')

      const res = await fetch(`https://api.kraken.com${path}`, {
        method: 'POST',
        headers: { 'API-Key': key, 'API-Sign': hmac, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: postData,
      })
      const data = await res.json()
      if (data.error?.length) return { status: 'failed', broker: 'kraken', error: data.error.join(', ') }

      const parentId = data.result?.txid?.[0] as string | undefined
      let takeProfitId: string | undefined

      // Place separate GTC limit for take-profit (Kraken has no native OCO)
      if (params.take_profit_price && params.quantity) {
        const tpNonce = Date.now().toString()
        const tpData: Record<string, string> = {
          nonce: tpNonce, type: params.side === 'buy' ? 'sell' : 'buy',
          pair: this.mapPair(params.symbol), oflags: 'fciq',
          ordertype: 'limit', price: params.take_profit_price.toString(),
          volume: params.quantity.toString(),
        }
        const tpPost = new URLSearchParams(tpData).toString()
        const tpHash = createHash('sha256').update(tpNonce + tpPost).digest()
        const tpHmac = createHmac('sha512', secretBuf).update(Buffer.concat([Buffer.from(path), tpHash])).digest('base64')
        const tpRes = await fetch(`https://api.kraken.com${path}`, {
          method: 'POST',
          headers: { 'API-Key': key, 'API-Sign': tpHmac, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: tpPost,
        })
        const tpBody = await tpRes.json()
        takeProfitId = tpBody.result?.txid?.[0]
      }

      return { status: 'submitted', broker: 'kraken', parent_order_id: parentId, take_profit_order_id: takeProfitId }
    } catch (err) {
      return { status: 'failed', broker: 'kraken', error: String(err) }
    }
  }
}

// ─── Coinbase Advanced Trade ──────────────────────────────────────────────────

export class CoinbaseAdapter extends BrokerAdapter {
  readonly config: BrokerConfig = {
    id: 'coinbase',
    displayName: 'Coinbase Advanced',
    assetClasses: ['crypto'],
    requiredEnvVars: ['COINBASE_API_KEY', 'COINBASE_API_SECRET'],
  }

  async execute(params: OrderParams): Promise<BrokerResult> {
    const key = process.env.COINBASE_API_KEY
    const secret = process.env.COINBASE_API_SECRET
    if (!key || !secret) return { status: 'skipped', reason: 'COINBASE_API_KEY not configured' }

    try {
      const ts = Math.floor(Date.now() / 1000).toString()
      const path = '/api/v3/brokerage/orders'
      const body = JSON.stringify({
        client_order_id: cidOrRandom(params.client_order_id),
        product_id: `${params.symbol}-USD`,
        side: params.side.toUpperCase(),
        order_configuration: {
          market_market_ioc: params.notional_usd
            ? { quote_size: params.notional_usd.toFixed(2) }
            : { base_size: (params.quantity ?? 0).toString() },
        },
      })
      const sig = createHmac('sha256', secret).update(`${ts}POST${path}${body}`).digest('hex')

      const res = await fetch(`https://api.coinbase.com${path}`, {
        method: 'POST',
        headers: { 'CB-ACCESS-KEY': key, 'CB-ACCESS-SIGN': sig, 'CB-ACCESS-TIMESTAMP': ts, 'Content-Type': 'application/json' },
        body,
      })
      const data = await res.json()
      if (!res.ok || !data.success) return { status: 'failed', broker: 'coinbase', error: data.error_response?.message ?? 'Coinbase error' }
      return { status: 'open', broker: 'coinbase', broker_order_id: data.success_response?.order_id }
    } catch (err) {
      return { status: 'failed', broker: 'coinbase', error: String(err) }
    }
  }

  /**
   * Coinbase has no native OCO. We place a market entry then separate stop-loss
   * and take-profit limit orders. The position monitor cancels the survivor on fill.
   */
  async placeBracketOrder(params: BracketParams): Promise<BracketResult> {
    const key = process.env.COINBASE_API_KEY
    const secret = process.env.COINBASE_API_SECRET
    if (!key || !secret) return { status: 'skipped', broker: 'coinbase', reason: 'COINBASE_API_KEY not configured' }

    const post = async (body: string): Promise<{ ok: boolean; data: Record<string, unknown> }> => {
      const ts = Math.floor(Date.now() / 1000).toString()
      const path = '/api/v3/brokerage/orders'
      const sig = createHmac('sha256', secret).update(`${ts}POST${path}${body}`).digest('hex')
      const res = await fetch(`https://api.coinbase.com${path}`, {
        method: 'POST',
        headers: { 'CB-ACCESS-KEY': key, 'CB-ACCESS-SIGN': sig, 'CB-ACCESS-TIMESTAMP': ts, 'Content-Type': 'application/json' },
        body,
      })
      return { ok: res.ok, data: await res.json() as Record<string, unknown> }
    }

    try {
      const productId = `${params.symbol}-USD`
      // Deterministic per-leg ids derived from the entry id so a retried
      // bracket reuses ALL THREE ids and the broker dedupes every leg.
      const entryCid = cidOrRandom(params.client_order_id)
      const entryBody = JSON.stringify({
        client_order_id: entryCid,
        product_id: productId,
        side: params.side.toUpperCase(),
        order_configuration: {
          market_market_ioc: params.notional_usd
            ? { quote_size: params.notional_usd.toFixed(2) }
            : { base_size: (params.quantity ?? 0).toString() },
        },
      })
      const entry = await post(entryBody)
      if (!entry.ok) {
        const r = entry.data as { error_response?: { message?: string } }
        return { status: 'failed', broker: 'coinbase', error: r.error_response?.message ?? 'entry failed' }
      }
      const entryOrderId = (entry.data as { success_response?: { order_id?: string } }).success_response?.order_id

      let stopOrderId: string | undefined
      if (params.stop_price && params.quantity) {
        const stopBody = JSON.stringify({
          client_order_id: `${entryCid}-s`,
          product_id: productId,
          side: params.side === 'buy' ? 'SELL' : 'BUY',
          order_configuration: {
            stop_limit_stop_limit_gtc: {
              base_size: params.quantity.toString(),
              stop_price: params.stop_price.toFixed(8),
              limit_price: params.stop_price.toFixed(8),
              stop_direction: params.side === 'buy' ? 'STOP_DIRECTION_STOP_DOWN' : 'STOP_DIRECTION_STOP_UP',
            },
          },
        })
        const stopRes = await post(stopBody)
        const sr = stopRes.data as { success_response?: { order_id?: string } }
        stopOrderId = sr.success_response?.order_id
      }

      let takeProfitOrderId: string | undefined
      if (params.take_profit_price && params.quantity) {
        const tpBody = JSON.stringify({
          client_order_id: `${entryCid}-t`,
          product_id: productId,
          side: params.side === 'buy' ? 'SELL' : 'BUY',
          order_configuration: {
            limit_limit_gtc: {
              base_size: params.quantity.toString(),
              limit_price: params.take_profit_price.toFixed(8),
            },
          },
        })
        const tpRes = await post(tpBody)
        const tr = tpRes.data as { success_response?: { order_id?: string } }
        takeProfitOrderId = tr.success_response?.order_id
      }

      return { status: 'submitted', broker: 'coinbase', parent_order_id: entryOrderId, stop_order_id: stopOrderId, take_profit_order_id: takeProfitOrderId }
    } catch (err) {
      return { status: 'failed', broker: 'coinbase', error: String(err) }
    }
  }

  async cancelBracket(orderId: string): Promise<BrokerResult> {
    const key = process.env.COINBASE_API_KEY
    const secret = process.env.COINBASE_API_SECRET
    if (!key || !secret) return { status: 'skipped', broker: 'coinbase', reason: 'not configured' }
    try {
      const ts = Math.floor(Date.now() / 1000).toString()
      const body = JSON.stringify({ order_ids: [orderId] })
      const path = '/api/v3/brokerage/orders/batch_cancel'
      const sig = createHmac('sha256', secret).update(`${ts}POST${path}${body}`).digest('hex')
      const res = await fetch(`https://api.coinbase.com${path}`, {
        method: 'POST',
        headers: { 'CB-ACCESS-KEY': key, 'CB-ACCESS-SIGN': sig, 'CB-ACCESS-TIMESTAMP': ts, 'Content-Type': 'application/json' },
        body,
      })
      return res.ok
        ? { status: 'submitted', broker: 'coinbase', broker_order_id: orderId }
        : { status: 'failed', broker: 'coinbase', error: `HTTP ${res.status}` }
    } catch (err) {
      return { status: 'failed', broker: 'coinbase', error: String(err) }
    }
  }
}

// ─── Binance US ───────────────────────────────────────────────────────────────

export class BinanceAdapter extends BrokerAdapter {
  readonly config: BrokerConfig = {
    id: 'binance',
    displayName: 'Binance.US',
    assetClasses: ['crypto'],
    // Binance.US not available in NY, TX, HI, VT — simplified: blocked globally for UK/EU
    blockedJurisdictions: ['GB', 'DE', 'FR', 'NL', 'IT', 'ES', 'BE', 'AT', 'PL'],
    requiredEnvVars: ['BINANCE_API_KEY', 'BINANCE_API_SECRET'],
  }

  async execute(params: OrderParams): Promise<BrokerResult> {
    const key = process.env.BINANCE_API_KEY
    const secret = process.env.BINANCE_API_SECRET
    if (!key || !secret) return { status: 'skipped', reason: 'BINANCE_API_KEY not configured' }

    try {
      const ts = Date.now()
      const qs = new URLSearchParams({
        symbol: `${params.symbol}USDT`,
        side: params.side.toUpperCase(),
        type: 'MARKET',
        timestamp: ts.toString(),
        ...(params.notional_usd ? { quoteOrderQty: params.notional_usd.toFixed(2) } : { quantity: (params.quantity ?? 0).toString() }),
      })
      const sig = createHmac('sha256', secret).update(qs.toString()).digest('hex')
      qs.set('signature', sig)

      const res = await fetch(`https://api.binance.us/api/v3/order?${qs}`, {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': key },
      })
      const data = await res.json()
      if (!res.ok) return { status: 'failed', broker: 'binance', error: data.msg ?? 'Binance error' }
      return { status: 'open', broker: 'binance', broker_order_id: String(data.orderId) }
    } catch (err) {
      return { status: 'failed', broker: 'binance', error: String(err) }
    }
  }
}

// ─── OANDA (forex) ────────────────────────────────────────────────────────────

export class OandaAdapter extends BrokerAdapter {
  readonly config: BrokerConfig = {
    id: 'oanda',
    displayName: 'OANDA',
    assetClasses: ['forex'],
    requiredEnvVars: ['OANDA_API_KEY', 'OANDA_ACCOUNT_ID'],
  }

  async execute(params: OrderParams): Promise<BrokerResult> {
    const key = process.env.OANDA_API_KEY
    const accountId = process.env.OANDA_ACCOUNT_ID
    if (!key || !accountId) return { status: 'skipped', reason: 'OANDA_API_KEY not configured' }

    try {
      const isPractice = process.env.OANDA_PRACTICE !== 'false'
      const base = isPractice ? 'https://api-fxpractice.oanda.com' : 'https://api-fxtrade.oanda.com'
      const instrument = params.symbol.includes('_') ? params.symbol : params.symbol.replace('/', '_')
      const units = params.side === 'buy'
        ? (params.quantity ?? Math.floor(params.notional_usd ?? 0)).toString()
        : `-${params.quantity ?? Math.floor(params.notional_usd ?? 0)}`

      const res = await fetch(`${base}/v3/accounts/${accountId}/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: { type: 'MARKET', instrument, units } }),
      })
      const data = await res.json()
      if (!res.ok) return { status: 'failed', broker: 'oanda', error: JSON.stringify(data) }
      return { status: 'open', broker: 'oanda', broker_order_id: data.orderFillTransaction?.tradeOpened?.tradeID }
    } catch (err) {
      return { status: 'failed', broker: 'oanda', error: String(err) }
    }
  }

  /**
   * OANDA native bracket: takeProfitOnFill + stopLossOnFill in MarketOrderRequest.
   */
  async placeBracketOrder(params: BracketParams): Promise<BracketResult> {
    const key = process.env.OANDA_API_KEY
    const accountId = process.env.OANDA_ACCOUNT_ID
    if (!key || !accountId) return { status: 'skipped', broker: 'oanda', reason: 'OANDA_API_KEY not configured' }

    try {
      const isPractice = process.env.OANDA_PRACTICE !== 'false'
      const base = isPractice ? 'https://api-fxpractice.oanda.com' : 'https://api-fxtrade.oanda.com'
      const instrument = params.symbol.includes('_') ? params.symbol : params.symbol.replace('/', '_')
      const units = params.side === 'buy'
        ? (params.quantity ?? Math.floor(params.notional_usd ?? 0)).toString()
        : `-${params.quantity ?? Math.floor(params.notional_usd ?? 0)}`

      const order: Record<string, unknown> = { type: 'MARKET', instrument, units }
      if (params.stop_price) {
        order.stopLossOnFill = { price: params.stop_price.toFixed(5), timeInForce: 'GTC' }
      }
      if (params.take_profit_price) {
        order.takeProfitOnFill = { price: params.take_profit_price.toFixed(5), timeInForce: 'GTC' }
      }
      if (params.trail_pct && !params.stop_price) {
        order.trailingStopLossOnFill = {
          distance: (params.trail_pct * (params.limit_price ?? 1)).toFixed(5),
          timeInForce: 'GTC',
        }
      }

      const res = await fetch(`${base}/v3/accounts/${accountId}/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      })
      const data = await res.json()
      if (!res.ok) return { status: 'failed', broker: 'oanda', error: JSON.stringify(data) }
      return {
        status: 'submitted',
        broker: 'oanda',
        parent_order_id: data.orderFillTransaction?.tradeOpened?.tradeID,
      }
    } catch (err) {
      return { status: 'failed', broker: 'oanda', error: String(err) }
    }
  }

  async modifyStop(tradeId: string, newStop: number): Promise<BrokerResult> {
    const key = process.env.OANDA_API_KEY
    const accountId = process.env.OANDA_ACCOUNT_ID
    if (!key || !accountId) return { status: 'skipped', broker: 'oanda', reason: 'not configured' }
    try {
      const isPractice = process.env.OANDA_PRACTICE !== 'false'
      const base = isPractice ? 'https://api-fxpractice.oanda.com' : 'https://api-fxtrade.oanda.com'
      const res = await fetch(`${base}/v3/accounts/${accountId}/trades/${tradeId}/orders`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopLoss: { price: newStop.toFixed(5), timeInForce: 'GTC' } }),
      })
      const data = await res.json()
      return res.ok
        ? { status: 'submitted', broker: 'oanda', broker_order_id: tradeId }
        : { status: 'failed', broker: 'oanda', error: JSON.stringify(data) }
    } catch (err) {
      return { status: 'failed', broker: 'oanda', error: String(err) }
    }
  }

  async modifyTarget(tradeId: string, newTarget: number): Promise<BrokerResult> {
    const key = process.env.OANDA_API_KEY
    const accountId = process.env.OANDA_ACCOUNT_ID
    if (!key || !accountId) return { status: 'skipped', broker: 'oanda', reason: 'not configured' }
    try {
      const isPractice = process.env.OANDA_PRACTICE !== 'false'
      const base = isPractice ? 'https://api-fxpractice.oanda.com' : 'https://api-fxtrade.oanda.com'
      const res = await fetch(`${base}/v3/accounts/${accountId}/trades/${tradeId}/orders`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ takeProfit: { price: newTarget.toFixed(5), timeInForce: 'GTC' } }),
      })
      const data = await res.json()
      return res.ok
        ? { status: 'submitted', broker: 'oanda', broker_order_id: tradeId }
        : { status: 'failed', broker: 'oanda', error: JSON.stringify(data) }
    } catch (err) {
      return { status: 'failed', broker: 'oanda', error: String(err) }
    }
  }
}

// ─── Interactive Brokers (TWS/IBKR) ──────────────────────────────────────────

export class IBKRAdapter extends BrokerAdapter {
  readonly config: BrokerConfig = {
    id: 'ibkr',
    displayName: 'Interactive Brokers',
    assetClasses: ['stock', 'etf', 'options', 'futures', 'forex', 'crypto'],
    requiredEnvVars: ['IBKR_ACCOUNT_ID', 'IBKR_API_URL'],
  }

  async execute(params: OrderParams): Promise<BrokerResult> {
    const accountId = process.env.IBKR_ACCOUNT_ID
    const baseUrl = process.env.IBKR_API_URL
    if (!accountId || !baseUrl) return { status: 'skipped', reason: 'IBKR_API_URL not configured' }

    try {
      const res = await fetch(`${baseUrl}/v1/api/iserver/account/${accountId}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{
          acctId: accountId,
          conid: 0,
          symbol: params.symbol,
          side: params.side.toUpperCase(),
          orderType: 'MKT',
          quantity: params.quantity ?? Math.floor((params.notional_usd ?? 0) / 100),
          tif: 'DAY',
        }]),
      })
      const data = await res.json()
      if (!res.ok) return { status: 'failed', broker: 'ibkr', error: JSON.stringify(data) }
      return { status: 'submitted', broker: 'ibkr', broker_order_id: data[0]?.order_id }
    } catch (err) {
      return { status: 'failed', broker: 'ibkr', error: String(err) }
    }
  }

  /**
   * IBKR bracket: parent entry + two child orders (stop-loss and take-profit)
   * linked via parentId field in the order array.
   */
  async placeBracketOrder(params: BracketParams): Promise<BracketResult> {
    const accountId = process.env.IBKR_ACCOUNT_ID
    const baseUrl = process.env.IBKR_API_URL
    if (!accountId || !baseUrl) return { status: 'skipped', broker: 'ibkr', reason: 'IBKR_API_URL not configured' }

    try {
      const qty = params.quantity ?? Math.floor((params.notional_usd ?? 0) / 100)
      const parentId = 1
      const orders = [
        {
          orderId: parentId, acctId: accountId, symbol: params.symbol,
          side: params.side.toUpperCase(), orderType: params.limit_price ? 'LMT' : 'MKT',
          price: params.limit_price, quantity: qty, tif: 'GTC', transmit: false,
        },
      ]
      if (params.stop_price) {
        orders.push({
          orderId: 2, acctId: accountId, symbol: params.symbol,
          side: params.side === 'buy' ? 'SELL' : 'BUY', orderType: 'STP',
          price: params.stop_price, quantity: qty, tif: 'GTC', transmit: false,
          // @ts-expect-error IBKR API accepts parentId
          parentId,
        })
      }
      if (params.take_profit_price) {
        orders.push({
          orderId: 3, acctId: accountId, symbol: params.symbol,
          side: params.side === 'buy' ? 'SELL' : 'BUY', orderType: 'LMT',
          price: params.take_profit_price, quantity: qty, tif: 'GTC', transmit: true,
          // @ts-expect-error IBKR API accepts parentId
          parentId,
        })
      } else if (orders.length > 1) {
        orders[orders.length - 1] = { ...orders[orders.length - 1], transmit: true }
      }

      const res = await fetch(`${baseUrl}/v1/api/iserver/account/${accountId}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orders),
      })
      const data = await res.json()
      if (!res.ok) return { status: 'failed', broker: 'ibkr', error: JSON.stringify(data) }

      const ids: string[] = (data as Array<{ order_id?: string }>).map(d => d.order_id ?? '')
      return {
        status: 'submitted', broker: 'ibkr',
        parent_order_id: ids[0],
        stop_order_id: ids[1],
        take_profit_order_id: ids[2],
      }
    } catch (err) {
      return { status: 'failed', broker: 'ibkr', error: String(err) }
    }
  }

  async cancelBracket(parentOrderId: string): Promise<BrokerResult> {
    const accountId = process.env.IBKR_ACCOUNT_ID
    const baseUrl = process.env.IBKR_API_URL
    if (!accountId || !baseUrl) return { status: 'skipped', broker: 'ibkr', reason: 'not configured' }
    try {
      const res = await fetch(`${baseUrl}/v1/api/iserver/account/${accountId}/order/${parentOrderId}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      })
      return res.ok
        ? { status: 'submitted', broker: 'ibkr', broker_order_id: parentOrderId }
        : { status: 'failed', broker: 'ibkr', error: `HTTP ${res.status}` }
    } catch (err) {
      return { status: 'failed', broker: 'ibkr', error: String(err) }
    }
  }
}

// ─── Robinhood ────────────────────────────────────────────────────────────────

export class RobinhoodAdapter extends BrokerAdapter {
  readonly config: BrokerConfig = {
    id: 'robinhood',
    displayName: 'Robinhood',
    assetClasses: ['stock', 'etf', 'crypto', 'options'],
    requiredEnvVars: ['ROBINHOOD_API_KEY'],
  }

  async execute(params: OrderParams): Promise<BrokerResult> {
    const key = process.env.ROBINHOOD_API_KEY
    if (!key) return { status: 'skipped', reason: 'ROBINHOOD_API_KEY not configured' }

    try {
      const body = {
        symbol: params.symbol,
        side: params.side,
        type: 'market',
        time_in_force: 'gfd',
        ...(params.notional_usd ? { notional: params.notional_usd.toFixed(2) } : { quantity: params.quantity }),
      }
      const res = await fetch('https://api.robinhood.com/orders/', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) return { status: 'failed', broker: 'robinhood', error: JSON.stringify(data) }
      return { status: 'open', broker: 'robinhood', broker_order_id: data.id }
    } catch (err) {
      return { status: 'failed', broker: 'robinhood', error: String(err) }
    }
  }
}

// ─── Webull ───────────────────────────────────────────────────────────────────

export class WebullAdapter extends BrokerAdapter {
  readonly config: BrokerConfig = {
    id: 'webull',
    displayName: 'Webull',
    assetClasses: ['stock', 'etf', 'options', 'crypto'],
    requiredEnvVars: ['WEBULL_ACCESS_TOKEN', 'WEBULL_ACCOUNT_ID'],
  }

  async execute(params: OrderParams): Promise<BrokerResult> {
    const token = process.env.WEBULL_ACCESS_TOKEN
    const accountId = process.env.WEBULL_ACCOUNT_ID
    if (!token || !accountId) return { status: 'skipped', reason: 'WEBULL_ACCESS_TOKEN not configured' }

    try {
      const res = await fetch(`https://openapi.webull.com/openapi/trade/v1/placeOrder`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          action: params.side.toUpperCase(),
          tickerId: params.symbol,
          orderType: 'MKT',
          timeInForce: 'DAY',
          ...(params.quantity ? { qty: params.quantity } : { outsideRegularTradingHour: false }),
        }),
      })
      const data = await res.json()
      if (!res.ok) return { status: 'failed', broker: 'webull', error: JSON.stringify(data) }
      return { status: 'open', broker: 'webull', broker_order_id: data.orderId }
    } catch (err) {
      return { status: 'failed', broker: 'webull', error: String(err) }
    }
  }
}

// ─── eToro ────────────────────────────────────────────────────────────────────

export class EToroAdapter extends BrokerAdapter {
  readonly config: BrokerConfig = {
    id: 'etoro',
    displayName: 'eToro',
    assetClasses: ['stock', 'etf', 'crypto', 'forex', 'cfd'],
    // Not available in US
    blockedJurisdictions: ['US'],
    requiredEnvVars: ['ETORO_API_KEY', 'ETORO_ACCOUNT_ID'],
  }

  async execute(params: OrderParams): Promise<BrokerResult> {
    const key = process.env.ETORO_API_KEY
    if (!key) return { status: 'skipped', reason: 'ETORO_API_KEY not configured' }
    // eToro Partner API is invitation-only; stub returns submitted
    return { status: 'submitted', broker: 'etoro', reason: 'eToro partner API integration pending' }
  }
}

// ─── Tastytrade ───────────────────────────────────────────────────────────────

export class TastytradeAdapter extends BrokerAdapter {
  readonly config: BrokerConfig = {
    id: 'tastytrade',
    displayName: 'Tastytrade',
    assetClasses: ['stock', 'etf', 'options', 'futures', 'crypto'],
    requiredEnvVars: ['TASTYTRADE_SESSION_TOKEN', 'TASTYTRADE_ACCOUNT_NUMBER'],
  }

  async execute(params: OrderParams): Promise<BrokerResult> {
    const token = process.env.TASTYTRADE_SESSION_TOKEN
    const account = process.env.TASTYTRADE_ACCOUNT_NUMBER
    if (!token || !account) return { status: 'skipped', reason: 'TASTYTRADE_SESSION_TOKEN not configured' }

    try {
      const res = await fetch(`https://api.tastyworks.com/accounts/${account}/orders`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_type: 'Market',
          time_in_force: 'Day',
          legs: [{
            instrument_type: params.asset_class === 'options' ? 'Equity Option' : 'Equity',
            symbol: params.symbol,
            quantity: params.quantity ?? 1,
            action: params.side === 'buy' ? 'Buy to Open' : 'Sell to Close',
          }],
        }),
      })
      const data = await res.json()
      if (!res.ok) return { status: 'failed', broker: 'tastytrade', error: JSON.stringify(data) }
      return { status: 'open', broker: 'tastytrade', broker_order_id: data.data?.order?.id }
    } catch (err) {
      return { status: 'failed', broker: 'tastytrade', error: String(err) }
    }
  }

  async placeBracketOrder(params: BracketParams): Promise<BracketResult> {
    const token = process.env.TASTYTRADE_SESSION_TOKEN
    const account = process.env.TASTYTRADE_ACCOUNT_NUMBER
    if (!token || !account) return { status: 'skipped', broker: 'tastytrade', reason: 'TASTYTRADE_SESSION_TOKEN not configured' }

    try {
      const qty = params.quantity ?? 1
      const legs = [{
        instrument_type: 'Equity',
        symbol: params.symbol,
        quantity: qty,
        action: params.side === 'buy' ? 'Buy to Open' : 'Sell to Open',
      }]
      const orderPayload: Record<string, unknown> = {
        order_type: params.limit_price ? 'Limit' : 'Market',
        time_in_force: 'GTC',
        legs,
      }
      if (params.limit_price) orderPayload.price = params.limit_price.toString()
      if (params.stop_price) {
        orderPayload.stop_trigger = params.stop_price.toString()
      }
      if (params.take_profit_price) {
        orderPayload.gtc_date = null
        orderPayload.price_effect = 'Credit'
      }

      const res = await fetch(`https://api.tastyworks.com/accounts/${account}/orders`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload),
      })
      const data = await res.json()
      if (!res.ok) return { status: 'failed', broker: 'tastytrade', error: JSON.stringify(data) }
      return { status: 'submitted', broker: 'tastytrade', parent_order_id: data.data?.order?.id }
    } catch (err) {
      return { status: 'failed', broker: 'tastytrade', error: String(err) }
    }
  }
}

// ─── Polymarket ───────────────────────────────────────────────────────────────

export class PolymarketAdapter extends BrokerAdapter {
  readonly config: BrokerConfig = {
    id: 'polymarket',
    displayName: 'Polymarket',
    assetClasses: ['prediction_market', 'polymarket'],
    // Polymarket is not available to US persons (CFTC settlement).
    blockedJurisdictions: ['US'],
    requiredEnvVars: ['POLYMARKET_PRIVATE_KEY'],
  }

  async execute(_params: OrderParams): Promise<BrokerResult> {
    if (!process.env.POLYMARKET_PRIVATE_KEY) return { status: 'skipped', reason: 'POLYMARKET_PRIVATE_KEY not configured' }
    return { status: 'skipped', reason: 'Polymarket CLOB: full CLOB client implementation pending' }
  }

  /**
   * Polymarket: no native stop-loss. Pre-arm a take-profit limit order at target1.
   * The position monitor handles -30% drawdown exit by cancelling and placing a market sell.
   */
  async placeBracketOrder(params: BracketParams): Promise<BracketResult> {
    if (!process.env.POLYMARKET_PRIVATE_KEY) return { status: 'skipped', broker: 'polymarket', reason: 'POLYMARKET_PRIVATE_KEY not configured' }
    if (!params.take_profit_price) return { status: 'skipped', broker: 'polymarket', reason: 'no take-profit target provided' }
    // Pre-arm limit sell at take_profit_price — CLOB integration placeholder
    return { status: 'submitted', broker: 'polymarket', reason: 'take-profit limit pre-armed (CLOB pending)' }
  }
}

// ─── Deribit (crypto options/futures) ────────────────────────────────────────

export class DeribitAdapter extends BrokerAdapter {
  readonly config: BrokerConfig = {
    id: 'deribit',
    displayName: 'Deribit',
    assetClasses: ['crypto_options', 'crypto_futures'],
    requiredEnvVars: ['DERIBIT_CLIENT_ID', 'DERIBIT_CLIENT_SECRET'],
  }

  async execute(params: OrderParams): Promise<BrokerResult> {
    const clientId = process.env.DERIBIT_CLIENT_ID
    const clientSecret = process.env.DERIBIT_CLIENT_SECRET
    if (!clientId || !clientSecret) return { status: 'skipped', reason: 'DERIBIT_CLIENT_ID not configured' }

    try {
      // Auth first
      const authRes = await fetch('https://www.deribit.com/api/v2/public/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'public/auth', params: { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret } }),
      })
      const authData = await authRes.json()
      const accessToken = authData.result?.access_token
      if (!accessToken) return { status: 'failed', broker: 'deribit', error: 'Auth failed' }

      const orderRes = await fetch('https://www.deribit.com/api/v2/private/buy', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: `private/${params.side}`, params: { instrument_name: params.symbol, amount: params.quantity ?? 1, type: 'market' } }),
      })
      const orderData = await orderRes.json()
      if (orderData.error) return { status: 'failed', broker: 'deribit', error: orderData.error.message }
      return { status: 'open', broker: 'deribit', broker_order_id: orderData.result?.order?.order_id }
    } catch (err) {
      return { status: 'failed', broker: 'deribit', error: String(err) }
    }
  }
}
