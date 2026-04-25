import { createHash, createHmac } from 'crypto'
import type { OrderParams, BrokerResult, BrokerConfig } from './types'
import { BrokerAdapter } from './types'

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
        client_order_id: `wos-${Date.now()}`,
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
}

// ─── Polymarket ───────────────────────────────────────────────────────────────

export class PolymarketAdapter extends BrokerAdapter {
  readonly config: BrokerConfig = {
    id: 'polymarket',
    displayName: 'Polymarket',
    assetClasses: ['prediction_market', 'polymarket'],
    requiredEnvVars: ['POLYMARKET_PRIVATE_KEY'],
  }

  async execute(_params: OrderParams): Promise<BrokerResult> {
    if (!process.env.POLYMARKET_PRIVATE_KEY) return { status: 'skipped', reason: 'POLYMARKET_PRIVATE_KEY not configured' }
    return { status: 'skipped', reason: 'Polymarket CLOB: full CLOB client implementation pending' }
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
