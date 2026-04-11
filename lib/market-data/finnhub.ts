/**
 * Finnhub.io market data client.
 * Free tier: 60 API calls/minute, real-time US stocks, news, sentiment.
 * Set: FINNHUB_API_KEY  (get free key at https://finnhub.io)
 *
 * Docs: https://finnhub.io/docs/api
 */

const BASE = 'https://finnhub.io/api/v1'

function finnhubEnabled(): boolean {
  return !!process.env.FINNHUB_API_KEY
}

function qs(params: Record<string, string | number | boolean>): string {
  const p = new URLSearchParams({ token: process.env.FINNHUB_API_KEY ?? '' })
  for (const [k, v] of Object.entries(params)) p.set(k, String(v))
  return p.toString()
}

async function finnhubGet<T>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T | null> {
  if (!finnhubEnabled()) return null
  try {
    const res = await fetch(`${BASE}${path}?${qs(params)}`, {
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return null
    return res.json() as Promise<T>
  } catch {
    return null
  }
}

// ─── Quotes ──────────────────────────────────────────────

export interface FinnhubQuote {
  symbol: string
  price: number         // c — current price
  open: number          // o
  high: number          // h
  low: number           // l
  prevClose: number     // pc
  change: number
  changePct: number
  timestamp: number     // t — unix timestamp
}

export async function fetchFinnhubQuote(symbol: string): Promise<FinnhubQuote | null> {
  const data = await finnhubGet<{ c: number; o: number; h: number; l: number; pc: number; t: number }>(
    '/quote', { symbol }
  )
  if (!data || !data.c) return null
  return {
    symbol: symbol.toUpperCase(),
    price: data.c,
    open: data.o,
    high: data.h,
    low: data.l,
    prevClose: data.pc,
    change: data.c - data.pc,
    changePct: data.pc > 0 ? ((data.c - data.pc) / data.pc) * 100 : 0,
    timestamp: data.t,
  }
}

export async function fetchFinnhubQuotes(symbols: string[]): Promise<Map<string, FinnhubQuote>> {
  const results = await Promise.allSettled(symbols.map(s => fetchFinnhubQuote(s)))
  const map = new Map<string, FinnhubQuote>()
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) map.set(r.value.symbol, r.value)
  }
  return map
}

// ─── Company News ─────────────────────────────────────────

export interface FinnhubNewsItem {
  id: number
  headline: string
  summary: string
  source: string
  url: string
  datetime: number   // unix timestamp
  category: string
  sentiment?: 'positive' | 'negative' | 'neutral'
}

export async function fetchCompanyNews(
  symbol: string,
  fromDate: string,
  toDate: string,
  limit = 20
): Promise<FinnhubNewsItem[]> {
  const data = await finnhubGet<Array<{
    id: number; headline: string; summary: string;
    source: string; url: string; datetime: number; category: string
  }>>('/company-news', { symbol, from: fromDate, to: toDate })
  if (!data) return []
  return data.slice(0, limit).map(n => ({ ...n, sentiment: undefined }))
}

/** Latest market news (no symbol filter — good for macro signals). */
export async function fetchMarketNews(category: 'general' | 'forex' | 'crypto' | 'merger' = 'general', limit = 20): Promise<FinnhubNewsItem[]> {
  const data = await finnhubGet<Array<{
    id: number; headline: string; summary: string;
    source: string; url: string; datetime: number; category: string
  }>>('/news', { category })
  if (!data) return []
  return data.slice(0, limit).map(n => ({ ...n, sentiment: undefined }))
}

// ─── Sentiment ────────────────────────────────────────────

export interface FinnhubSentiment {
  symbol: string
  bullishPct: number
  bearishPct: number
  buzz: number       // relative volume / social mentions score
  score: number      // net sentiment [-1, 1]
}

export async function fetchSentiment(symbol: string): Promise<FinnhubSentiment | null> {
  const data = await finnhubGet<{
    data?: Array<{
      bullishPercent: number
      bearishPercent: number
      buzz: { buzz: number }
      sentiment: { bullishPercent: number; bearishPercent: number }
    }>
    symbol?: string
  }>('/stock/social-sentiment', { symbol, from: new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10) })
  if (!data?.data?.length) return null
  const latest = data.data[data.data.length - 1]
  const bull = latest.bullishPercent ?? 50
  const bear = latest.bearishPercent ?? 50
  return {
    symbol: symbol.toUpperCase(),
    bullishPct: bull,
    bearishPct: bear,
    buzz: latest.buzz?.buzz ?? 0,
    score: (bull - bear) / 100,
  }
}

// ─── Earnings ─────────────────────────────────────────────

export interface EarningsEstimate {
  symbol: string
  quarter: string
  epsEstimate?: number
  epsActual?: number
  surprise?: number
  surprisePct?: number
}

export async function fetchEarnings(symbol: string): Promise<EarningsEstimate[]> {
  const data = await finnhubGet<{
    earningsCalendar?: Array<{
      date: string; epsEstimate: number; epsActual: number; surprisePercent: number
    }>
  }>('/stock/earnings', { symbol, limit: 8 })
  if (!data?.earningsCalendar) return []
  return data.earningsCalendar.map(e => ({
    symbol,
    quarter: e.date,
    epsEstimate: e.epsEstimate,
    epsActual: e.epsActual,
    surprise: e.epsActual != null && e.epsEstimate != null ? e.epsActual - e.epsEstimate : undefined,
    surprisePct: e.surprisePercent,
  }))
}

// ─── Basic Financials ─────────────────────────────────────

export interface StockMetrics {
  symbol: string
  pe?: number
  pb?: number
  ps?: number
  eps?: number
  revenueGrowth?: number
  roe?: number
  debtToEquity?: number
  beta?: number
}

export async function fetchStockMetrics(symbol: string): Promise<StockMetrics | null> {
  const data = await finnhubGet<{ metric?: Record<string, number> }>('/stock/metric', { symbol, metric: 'all' })
  if (!data?.metric) return null
  const m = data.metric
  return {
    symbol,
    pe: m['peBasicExclExtraTTM'],
    pb: m['pbAnnual'],
    ps: m['psAnnual'],
    eps: m['epsBasicExclExtraAnnual'],
    revenueGrowth: m['revenueGrowthTTMYoy'],
    roe: m['roeTTM'],
    debtToEquity: m['totalDebt/totalEquityAnnual'],
    beta: m['beta'],
  }
}
