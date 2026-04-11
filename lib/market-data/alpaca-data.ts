/**
 * Alpaca Markets Data API client.
 * Free with a paper trading account — provides IEX real-time quotes + historical bars.
 * Set: ALPACA_API_KEY, ALPACA_SECRET_KEY
 *
 * Docs: https://docs.alpaca.markets/reference/stocklatestquotes
 */
import type { PriceBar } from '@/lib/backtester'

const DATA_BASE = 'https://data.alpaca.markets'

function alpacaHeaders() {
  return {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY ?? '',
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY ?? '',
  }
}

function alpacaEnabled(): boolean {
  return !!(process.env.ALPACA_API_KEY && process.env.ALPACA_SECRET_KEY)
}

export interface AlpacaQuote {
  symbol: string
  askPrice: number
  bidPrice: number
  askSize: number
  bidSize: number
  timestamp: string
}

export interface AlpacaBar {
  symbol: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  timestamp: string
}

/** Get latest quote for a single stock symbol. */
export async function fetchAlpacaQuote(symbol: string): Promise<AlpacaQuote | null> {
  if (!alpacaEnabled()) return null
  try {
    const res = await fetch(
      `${DATA_BASE}/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest?feed=iex`,
      { headers: alpacaHeaders() }
    )
    if (!res.ok) return null
    const data = await res.json()
    const q = data.quote
    return {
      symbol: symbol.toUpperCase(),
      askPrice: q.ap ?? 0,
      bidPrice: q.bp ?? 0,
      askSize: q.as ?? 0,
      bidSize: q.bs ?? 0,
      timestamp: q.t,
    }
  } catch {
    return null
  }
}

/** Get latest quotes for multiple symbols in one request. */
export async function fetchAlpacaQuotes(symbols: string[]): Promise<Map<string, AlpacaQuote>> {
  if (!alpacaEnabled() || !symbols.length) return new Map()
  try {
    const syms = symbols.join(',')
    const res = await fetch(
      `${DATA_BASE}/v2/stocks/quotes/latest?symbols=${encodeURIComponent(syms)}&feed=iex`,
      { headers: alpacaHeaders() }
    )
    if (!res.ok) return new Map()
    const data = await res.json()
    const map = new Map<string, AlpacaQuote>()
    for (const [sym, q] of Object.entries(data.quotes ?? {})) {
      const quote = q as Record<string, number | string>
      map.set(sym, {
        symbol: sym,
        askPrice: quote.ap as number ?? 0,
        bidPrice: quote.bp as number ?? 0,
        askSize: quote.as as number ?? 0,
        bidSize: quote.bs as number ?? 0,
        timestamp: quote.t as string,
      })
    }
    return map
  } catch {
    return new Map()
  }
}

/** Get latest bars for multiple symbols (snapshot endpoint). */
export async function fetchAlpacaLatestBars(symbols: string[]): Promise<Map<string, AlpacaBar>> {
  if (!alpacaEnabled() || !symbols.length) return new Map()
  try {
    const syms = symbols.join(',')
    const res = await fetch(
      `${DATA_BASE}/v2/stocks/bars/latest?symbols=${encodeURIComponent(syms)}&feed=iex`,
      { headers: alpacaHeaders() }
    )
    if (!res.ok) return new Map()
    const data = await res.json()
    const map = new Map<string, AlpacaBar>()
    for (const [sym, b] of Object.entries(data.bars ?? {})) {
      const bar = b as Record<string, number | string>
      map.set(sym, {
        symbol: sym,
        open: bar.o as number,
        high: bar.h as number,
        low: bar.l as number,
        close: bar.c as number,
        volume: bar.v as number,
        timestamp: bar.t as string,
      })
    }
    return map
  } catch {
    return new Map()
  }
}

/** Fetch historical daily bars from Alpaca for use in backtests. */
export async function fetchAlpacaBars(
  symbol: string,
  startDate: string,
  endDate: string,
  timeframe = '1Day'
): Promise<PriceBar[]> {
  if (!alpacaEnabled()) return []
  try {
    const url = new URL(`${DATA_BASE}/v2/stocks/${encodeURIComponent(symbol)}/bars`)
    url.searchParams.set('start', startDate)
    url.searchParams.set('end', endDate)
    url.searchParams.set('timeframe', timeframe)
    url.searchParams.set('feed', 'iex')
    url.searchParams.set('limit', '10000')

    const bars: PriceBar[] = []
    let pageToken: string | null = null

    do {
      if (pageToken) url.searchParams.set('page_token', pageToken)
      const res = await fetch(url.toString(), { headers: alpacaHeaders() })
      if (!res.ok) break
      const data = await res.json()
      for (const b of data.bars ?? []) {
        bars.push({
          date: b.t.slice(0, 10),
          symbol: symbol.toUpperCase(),
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: b.v,
        })
      }
      pageToken = data.next_page_token ?? null
    } while (pageToken)

    return bars
  } catch {
    return []
  }
}

/** Get paper trading account info (balances, equity, buying power). */
export async function fetchAlpacaAccount(): Promise<Record<string, unknown> | null> {
  if (!alpacaEnabled()) return null
  try {
    const base = process.env.ALPACA_LIVE === 'true'
      ? 'https://api.alpaca.markets'
      : 'https://paper-api.alpaca.markets'
    const res = await fetch(`${base}/v2/account`, { headers: alpacaHeaders() })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

/** Get open positions from the paper/live account. */
export async function fetchAlpacaPositions(): Promise<Record<string, unknown>[]> {
  if (!alpacaEnabled()) return []
  try {
    const base = process.env.ALPACA_LIVE === 'true'
      ? 'https://api.alpaca.markets'
      : 'https://paper-api.alpaca.markets'
    const res = await fetch(`${base}/v2/positions`, { headers: alpacaHeaders() })
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

/** Get recent orders from the paper/live account. */
export async function fetchAlpacaOrders(status = 'all', limit = 50): Promise<Record<string, unknown>[]> {
  if (!alpacaEnabled()) return []
  try {
    const base = process.env.ALPACA_LIVE === 'true'
      ? 'https://api.alpaca.markets'
      : 'https://paper-api.alpaca.markets'
    const res = await fetch(
      `${base}/v2/orders?status=${status}&limit=${limit}&direction=desc`,
      { headers: alpacaHeaders() }
    )
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}
