import { createHash, createHmac } from 'crypto'
import { mapToKrakenPair } from './broker-router'

const KRAKEN_BASE = 'https://api.kraken.com'

function sign(path: string, postData: string, nonce: string, secret: string): string {
  const secretBuffer = Buffer.from(secret, 'base64')
  const hash = createHash('sha256').update(nonce + postData).digest()
  return createHmac('sha512', secretBuffer)
    .update(Buffer.concat([Buffer.from(path), hash]))
    .digest('base64')
}

async function privateRequest(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const key = process.env.KRAKEN_API_KEY
  const secret = process.env.KRAKEN_API_SECRET
  if (!key || !secret) throw new Error('Kraken API keys not configured')

  const nonce = Date.now().toString()
  const postData = new URLSearchParams({ nonce, ...params }).toString()
  const hmac = sign(path, postData, nonce, secret)

  const res = await fetch(`${KRAKEN_BASE}${path}`, {
    method: 'POST',
    headers: { 'API-Key': key, 'API-Sign': hmac, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: postData,
  })
  const data = await res.json() as { error: string[]; result: unknown }
  if (data.error?.length) throw new Error(data.error.join(', '))
  return data.result
}

async function publicRequest(path: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(`${KRAKEN_BASE}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString())
  const data = await res.json() as { error: string[]; result: unknown }
  if (data.error?.length) throw new Error(data.error.join(', '))
  return data.result
}

export interface KrakenTicker {
  symbol: string
  pair: string
  price_usd: number
  bid: number
  ask: number
  volume_24h: number
  high_24h: number
  low_24h: number
}

export async function getTickers(symbols: string[]): Promise<KrakenTicker[]> {
  if (!symbols.length) return []
  const pairs = symbols.map(s => mapToKrakenPair(s)).join(',')
  const result = await publicRequest('/0/public/Ticker', { pair: pairs }) as Record<string, {
    b: string[]; a: string[]; c: string[]; v: string[]; h: string[]; l: string[]
  }>

  return symbols.map((symbol, i) => {
    const pair = mapToKrakenPair(symbol)
    const t = result[pair] ?? Object.values(result)[i]
    if (!t) return null
    return {
      symbol,
      pair,
      price_usd: parseFloat(t.c[0]),
      bid: parseFloat(t.b[0]),
      ask: parseFloat(t.a[0]),
      volume_24h: parseFloat(t.v[1]),
      high_24h: parseFloat(t.h[1]),
      low_24h: parseFloat(t.l[1]),
    }
  }).filter(Boolean) as KrakenTicker[]
}

export interface KrakenBalance {
  symbol: string
  balance: number
}

export async function getBalances(): Promise<KrakenBalance[]> {
  const result = await privateRequest('/0/private/Balance') as Record<string, string>
  return Object.entries(result)
    .map(([pair, balance]) => ({
      symbol: pair.startsWith('X') && pair.length === 4 ? pair.slice(1) : pair,
      balance: parseFloat(balance),
    }))
    .filter(b => b.balance > 0)
}

export interface KrakenOrderBookLevel {
  price: number
  volume: number
}

export interface KrakenOrderBook {
  bids: KrakenOrderBookLevel[]
  asks: KrakenOrderBookLevel[]
}

export async function getOrderBook(symbol: string, depth = 10): Promise<KrakenOrderBook> {
  const pair = mapToKrakenPair(symbol)
  const result = await publicRequest('/0/public/Depth', { pair, count: depth.toString() }) as Record<string, {
    bids: [string, string][]; asks: [string, string][]
  }>
  const book = Object.values(result)[0]
  return {
    bids: book.bids.map(([price, vol]) => ({ price: parseFloat(price), volume: parseFloat(vol) })),
    asks: book.asks.map(([price, vol]) => ({ price: parseFloat(price), volume: parseFloat(vol) })),
  }
}
