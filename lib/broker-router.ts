import { createHash, createHmac } from 'crypto'
import { isGuardTokenValid, liveTradingEnabled, PAPER_PHASE_REASON, type GuardToken } from './broker-adapters/execution-guard'

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
}

export interface BrokerResult {
  status: 'open' | 'submitted' | 'skipped' | 'failed'
  broker?: string
  broker_order_id?: string
  error?: string
  reason?: string
}

// ─── Alpaca ───────────────────────────────────────────────────────────────
export async function executeViaAlpaca(params: OrderParams): Promise<BrokerResult> {
  const key = process.env.ALPACA_API_KEY
  const secret = process.env.ALPACA_SECRET_KEY
  if (!key || !secret) return { status: 'skipped', reason: 'ALPACA_API_KEY not configured' }

  try {
    const baseUrl = process.env.ALPACA_LIVE === 'true'
      ? 'https://api.alpaca.markets'
      : 'https://paper-api.alpaca.markets'

    const body: Record<string, unknown> = {
      symbol: params.symbol,
      side: params.side,
      type: params.order_type ?? 'market',
      time_in_force: params.time_in_force ?? 'day',
    }

    if (params.notional_usd && !params.quantity) {
      body.notional = params.notional_usd.toFixed(2)
    } else if (params.quantity) {
      body.qty = params.quantity.toString()
    }

    if (params.limit_price) body.limit_price = params.limit_price.toString()
    if (params.stop_price) body.stop_price = params.stop_price.toString()
    if (params.trail_amount) body.trail_price = params.trail_amount.toString()
    if (params.trail_percent) body.trail_percent = params.trail_percent.toString()

    const res = await fetch(`${baseUrl}/v2/orders`, {
      method: 'POST',
      headers: {
        'APCA-API-KEY-ID': key,
        'APCA-API-SECRET-KEY': secret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) return { status: 'failed', broker: 'alpaca', error: data.message ?? 'Alpaca error' }
    return { status: 'open', broker: 'alpaca', broker_order_id: data.id }
  } catch (err) {
    return { status: 'failed', broker: 'alpaca', error: String(err) }
  }
}

// ─── Kraken ───────────────────────────────────────────────────────────────
export function mapToKrakenPair(symbol: string): string {
  const map: Record<string, string> = {
    BTC: 'XXBTZUSD', ETH: 'XETHZUSD', SOL: 'SOLUSD',
    ADA: 'ADAUSD', DOT: 'DOTUSD', AVAX: 'AVAXUSD',
    MATIC: 'MATICUSD', LINK: 'LINKUSD', XRP: 'XXRPZUSD',
    LTC: 'XLTCZUSD', DOGE: 'XDGEUSD',
  }
  return map[symbol.toUpperCase()] ?? `${symbol.toUpperCase()}USD`
}

export async function executeViaKraken(params: OrderParams): Promise<BrokerResult> {
  const key = process.env.KRAKEN_API_KEY
  const secret = process.env.KRAKEN_API_SECRET
  if (!key || !secret) return { status: 'skipped', reason: 'KRAKEN_API_KEY not configured' }

  try {
    const nonce = Date.now().toString()
    const path = '/0/private/AddOrder'
    const pair = mapToKrakenPair(params.symbol)

    const orderData: Record<string, string> = {
      nonce,
      ordertype: params.order_type === 'limit' ? 'limit'
        : params.order_type === 'stop' ? 'stop-loss'
        : params.order_type === 'stop_limit' ? 'stop-loss-limit'
        : 'market',
      type: params.side,
      pair,
      oflags: 'fciq',
    }

    if (params.quantity) {
      orderData.volume = params.quantity.toString()
    } else if (params.notional_usd) {
      // Kraken requires volume in base currency — approximate with notional
      orderData.volume = '0' // Will be rejected, but best we can do without live price
    }
    if (params.limit_price) orderData.price = params.limit_price.toString()
    if (params.stop_price) orderData.price2 = params.stop_price.toString()

    const postData = new URLSearchParams(orderData).toString()
    const secretBuffer = Buffer.from(secret, 'base64')
    const hash = createHash('sha256').update(nonce + postData).digest()
    const hmac = createHmac('sha512', secretBuffer)
      .update(Buffer.concat([Buffer.from(path), hash]))
      .digest('base64')

    const res = await fetch(`https://api.kraken.com${path}`, {
      method: 'POST',
      headers: { 'API-Key': key, 'API-Sign': hmac, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: postData,
    })
    const data = await res.json()
    if (data.error?.length) return { status: 'failed', broker: 'kraken', error: data.error.join(', ') }
    return { status: 'open', broker: 'kraken', broker_order_id: data.result?.txid?.[0] ?? undefined }
  } catch (err) {
    return { status: 'failed', broker: 'kraken', error: String(err) }
  }
}

// ─── OANDA ────────────────────────────────────────────────────────────────
export async function executeViaOanda(params: OrderParams): Promise<BrokerResult> {
  const key = process.env.OANDA_API_KEY
  const accountId = process.env.OANDA_ACCOUNT_ID
  if (!key || !accountId) return { status: 'skipped', reason: 'OANDA_API_KEY not configured' }

  try {
    const isPractice = process.env.OANDA_PRACTICE !== 'false'
    const base = isPractice ? 'https://api-fxpractice.oanda.com' : 'https://api-fxtrade.oanda.com'

    const instrument = params.symbol.includes('_') ? params.symbol : params.symbol.replace('/', '_')
    const units = params.side === 'buy'
      ? (params.quantity ?? Math.floor((params.notional_usd ?? 0) / 1)).toString()
      : `-${params.quantity ?? Math.floor((params.notional_usd ?? 0) / 1)}`

    const body: Record<string, unknown> = { order: { type: 'MARKET', instrument, units } }
    if (params.order_type === 'limit' && params.limit_price) {
      body.order = { type: 'LIMIT', instrument, units, price: params.limit_price.toString(), timeInForce: 'GTC' }
    }

    const res = await fetch(`${base}/v3/accounts/${accountId}/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) return { status: 'failed', broker: 'oanda', error: JSON.stringify(data) }
    const tradeId = data.orderFillTransaction?.tradeOpened?.tradeID ?? data.relatedTransactionIDs?.[0]
    return { status: 'open', broker: 'oanda', broker_order_id: tradeId }
  } catch (err) {
    return { status: 'failed', broker: 'oanda', error: String(err) }
  }
}

// ─── Polymarket ───────────────────────────────────────────────────────────
export async function executeViaPolymarket(params: OrderParams): Promise<BrokerResult> {
  const key = process.env.POLYMARKET_PRIVATE_KEY
  if (!key) return { status: 'skipped', reason: 'POLYMARKET_PRIVATE_KEY not configured' }
  return { status: 'skipped', reason: 'Polymarket CLOB: full CLOB client implementation pending' }
}

// ─── Router ───────────────────────────────────────────────────────────────
export async function submitOrder(
  params: OrderParams,
  guard?: GuardToken
): Promise<BrokerResult> {
  // Refuse ungated submissions (kill switch / cost gate enforced upstream via
  // preExecutionGuard) and everything while the live master switch is off.
  if (!isGuardTokenValid(guard)) {
    return {
      status: 'failed',
      reason: 'ungated submission refused — run preExecutionGuard() and pass its token',
    }
  }
  if (!liveTradingEnabled()) {
    return { status: 'skipped', reason: PAPER_PHASE_REASON }
  }
  const broker = params.broker_override ?? params.asset_class
  switch (broker) {
    case 'stock':
    case 'alpaca':
      return executeViaAlpaca(params)
    case 'crypto':
    case 'kraken':
      return executeViaKraken(params)
    case 'forex':
    case 'oanda':
      return executeViaOanda(params)
    case 'polymarket':
      return executeViaPolymarket(params)
    default:
      return { status: 'skipped', reason: `Unknown broker/asset class: ${broker}` }
  }
}
