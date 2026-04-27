const isPractice = process.env.OANDA_PRACTICE !== 'false'
const OANDA_BASE = isPractice
  ? 'https://api-fxpractice.oanda.com'
  : 'https://api-fxtrade.oanda.com'

async function oandaFetch(path: string, init?: RequestInit): Promise<unknown> {
  const key = process.env.OANDA_API_KEY
  if (!key) throw new Error('OANDA_API_KEY not configured')

  const res = await fetch(`${OANDA_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const data = await res.json() as Record<string, unknown>
  if (!res.ok) throw new Error(JSON.stringify(data))
  return data
}

export interface OandaPrice {
  instrument: string
  bid: number
  ask: number
  spread_pips: number
}

export async function getPricing(instruments: string[]): Promise<OandaPrice[]> {
  const accountId = process.env.OANDA_ACCOUNT_ID
  if (!accountId) throw new Error('OANDA_ACCOUNT_ID not configured')

  const data = await oandaFetch(
    `/v3/accounts/${accountId}/pricing?instruments=${instruments.join('%2C')}`
  ) as { prices: Array<{ instrument: string; bids: Array<{ price: string }>; asks: Array<{ price: string }> }> }

  return (data.prices ?? []).map(p => {
    const bid = parseFloat(p.bids?.[0]?.price ?? '0')
    const ask = parseFloat(p.asks?.[0]?.price ?? '0')
    // Spread in pips (4th decimal for most pairs, 2nd for JPY)
    const pipSize = p.instrument.includes('JPY') ? 0.01 : 0.0001
    return { instrument: p.instrument, bid, ask, spread_pips: (ask - bid) / pipSize }
  })
}

export interface OandaAccount {
  id: string
  currency: string
  balance: number
  nav: number
  unrealized_pl: number
  open_trade_count: number
}

export async function getAccount(): Promise<OandaAccount> {
  const accountId = process.env.OANDA_ACCOUNT_ID
  if (!accountId) throw new Error('OANDA_ACCOUNT_ID not configured')

  const data = await oandaFetch(`/v3/accounts/${accountId}/summary`) as {
    account: { id: string; currency: string; balance: string; NAV: string; unrealizedPL: string; openTradeCount: number }
  }
  const a = data.account
  return {
    id: a.id,
    currency: a.currency,
    balance: parseFloat(a.balance),
    nav: parseFloat(a.NAV),
    unrealized_pl: parseFloat(a.unrealizedPL),
    open_trade_count: a.openTradeCount,
  }
}

export interface OandaTrade {
  id: string
  instrument: string
  price: number
  current_units: number
  unrealized_pl: number
}

export async function getOpenTrades(): Promise<OandaTrade[]> {
  const accountId = process.env.OANDA_ACCOUNT_ID
  if (!accountId) throw new Error('OANDA_ACCOUNT_ID not configured')

  const data = await oandaFetch(`/v3/accounts/${accountId}/openTrades`) as {
    trades: Array<{ id: string; instrument: string; price: string; currentUnits: string; unrealizedPL: string }>
  }
  return (data.trades ?? []).map(t => ({
    id: t.id,
    instrument: t.instrument,
    price: parseFloat(t.price),
    current_units: parseFloat(t.currentUnits),
    unrealized_pl: parseFloat(t.unrealizedPL),
  }))
}

// ─── Candles ──────────────────────────────────────────────────────────────────

export interface OandaCandle {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  complete: boolean
}

/**
 * Fetch OANDA candlestick data.
 * @param instrument  e.g. 'EUR_USD'
 * @param granularity 'M1' | 'M5' | 'M15' | 'H1' | 'H4' | 'D'
 * @param count       Number of candles to fetch (max 5000)
 */
export async function getCandles(
  instrument: string,
  granularity: 'M1' | 'M5' | 'M15' | 'H1' | 'H4' | 'D',
  count: number
): Promise<OandaCandle[]> {
  try {
    const data = await oandaFetch(
      `/v3/instruments/${instrument}/candles?granularity=${granularity}&count=${count}&price=M`
    ) as { candles: Array<{ time: string; mid: { o: string; h: string; l: string; c: string }; volume: number; complete: boolean }> }
    return (data.candles ?? []).map(c => ({
      time: c.time,
      open:  parseFloat(c.mid.o),
      high:  parseFloat(c.mid.h),
      low:   parseFloat(c.mid.l),
      close: parseFloat(c.mid.c),
      volume: c.volume,
      complete: c.complete,
    }))
  } catch {
    return []
  }
}

/** True if OANDA is configured (API key + account ID present). */
export function oandaEnabled(): boolean {
  return !!(process.env.OANDA_API_KEY && process.env.OANDA_ACCOUNT_ID)
}

/** Fetch current bid/ask for a single instrument. Returns null if unavailable. */
export async function getBidAsk(
  instrument: string
): Promise<{ bid: number; ask: number } | null> {
  try {
    const prices = await getPricing([instrument])
    const p = prices[0]
    if (!p) return null
    return { bid: p.bid, ask: p.ask }
  } catch {
    return null
  }
}
