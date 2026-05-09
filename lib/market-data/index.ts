/**
 * Unified market data facade.
 *
 * Priority for real-time quotes:
 *   1. Alpaca IEX (free with paper account, ~15 min delayed on free tier)
 *   2. Finnhub (free tier, 60 req/min)
 *   3. Yahoo Finance (delayed, always available, no key needed)
 *
 * Priority for historical bars:
 *   1. Alpaca (accurate, free with paper account)
 *   2. Yahoo Finance (free, no key needed)
 *   3. Synthetic GBM fallback (always available)
 */

import { fetchAlpacaQuotes, fetchAlpacaLatestBars, fetchAlpacaBars } from './alpaca-data'
import { fetchFinnhubQuote, fetchFinnhubQuotes } from './finnhub'
import { fetchYahooQuote, fetchYahooQuotes, fetchHistoricalBars, fetchBarsForSymbols } from './yahoo'
import { generateSyntheticBars } from '@/lib/backtester'
import type { PriceBar } from '@/lib/backtester'

export * from './yahoo'
export * from './alpaca-data'
export * from './finnhub'

// ─── Unified quote ────────────────────────────────────────

export interface UnifiedQuote {
  symbol: string
  price: number
  change: number
  changePct: number
  bid?: number
  ask?: number
  volume?: number
  source: 'alpaca' | 'finnhub' | 'yahoo'
}

export async function getQuote(symbol: string): Promise<UnifiedQuote | null> {
  // Try Alpaca first
  const alpacaMap = await fetchAlpacaQuotes([symbol])
  const alpacaBar = (await fetchAlpacaLatestBars([symbol])).get(symbol)
  if (alpacaMap.size > 0 && alpacaBar) {
    const q = alpacaMap.get(symbol)!
    const prevClose = alpacaBar.open  // approximate
    return {
      symbol,
      price: alpacaBar.close,
      change: alpacaBar.close - prevClose,
      changePct: prevClose > 0 ? ((alpacaBar.close - prevClose) / prevClose) * 100 : 0,
      bid: q.bidPrice,
      ask: q.askPrice,
      volume: alpacaBar.volume,
      source: 'alpaca',
    }
  }

  // Try Finnhub
  const finnhub = await fetchFinnhubQuote(symbol)
  if (finnhub) {
    return {
      symbol,
      price: finnhub.price,
      change: finnhub.change,
      changePct: finnhub.changePct,
      volume: undefined,
      source: 'finnhub',
    }
  }

  // Yahoo fallback
  const yahoo = await fetchYahooQuote(symbol)
  if (yahoo) {
    return {
      symbol,
      price: yahoo.price,
      change: yahoo.change,
      changePct: yahoo.changePct,
      volume: yahoo.volume,
      source: 'yahoo',
    }
  }

  return null
}

/** Get quotes for multiple symbols, mixed sources per symbol. */
export async function getQuotes(symbols: string[]): Promise<Map<string, UnifiedQuote>> {
  const map = new Map<string, UnifiedQuote>()
  if (!symbols.length) return map

  // Normalize all symbols to uppercase at the boundary
  const normalized = symbols.map(s => s.toUpperCase())

  // Batch Alpaca
  const [alpacaQuotes, alpacaBars] = await Promise.all([
    fetchAlpacaQuotes(normalized),
    fetchAlpacaLatestBars(normalized),
  ])
  for (const sym of normalized) {
    const q = alpacaQuotes.get(sym)
    const b = alpacaBars.get(sym)
    if (q && b) {
      const prev = b.open
      map.set(sym, {
        symbol: sym,
        price: b.close,
        change: b.close - prev,
        changePct: prev > 0 ? ((b.close - prev) / prev) * 100 : 0,
        bid: q.bidPrice,
        ask: q.askPrice,
        volume: b.volume,
        source: 'alpaca',
      })
    }
  }

  const missing = normalized.filter(s => !map.has(s))
  if (!missing.length) return map

  // Batch Finnhub for missing
  const finnhubMap = await fetchFinnhubQuotes(missing)
  for (const [sym, fq] of finnhubMap) {
    map.set(sym, {
      symbol: sym,
      price: fq.price,
      change: fq.change,
      changePct: fq.changePct,
      source: 'finnhub',
    })
  }

  const stillMissing = missing.filter(s => !map.has(s))
  if (!stillMissing.length) return map

  // Yahoo for anything left
  const yahooQuotes = await fetchYahooQuotes(stillMissing)
  for (const yq of yahooQuotes) {
    map.set(yq.symbol, {
      symbol: yq.symbol,
      price: yq.price,
      change: yq.change,
      changePct: yq.changePct,
      volume: yq.volume,
      source: 'yahoo',
    })
  }

  return map
}

// ─── Unified historical bars ──────────────────────────────

/**
 * Get historical daily OHLCV bars for a symbol.
 * Falls back through Alpaca → Yahoo → synthetic GBM.
 */
export async function getBars(
  symbol: string,
  startDate: string,
  endDate: string
): Promise<PriceBar[]> {
  // Try Alpaca
  const alpacaBars = await fetchAlpacaBars(symbol, startDate, endDate)
  if (alpacaBars.length > 10) return alpacaBars

  // Try Yahoo
  const yahooBars = await fetchHistoricalBars(symbol, startDate, endDate)
  if (yahooBars.length > 10) return yahooBars

  // Synthetic fallback
  return generateSyntheticBars(symbol, startDate, endDate)
}

/**
 * Normalise a symbol to Yahoo Finance format based on asset class.
 * Used by the learning loop so grading fetches real data, not synthetic.
 *   crypto:  BTC       → BTC-USD
 *   forex:   EURUSD    → EURUSD=X
 *   stocks/options/multi-asset: pass through unchanged
 */
export function normaliseSymbolForGrading(symbol: string, assetClass: string): string {
  const s = symbol.toUpperCase()
  if (assetClass === 'crypto') {
    // Already suffixed (e.g. BTC-USD) → leave alone; otherwise append -USD
    return s.includes('-') ? s : `${s}-USD`
  }
  if (assetClass === 'forex') {
    // Already suffixed (e.g. EURUSD=X) → leave alone; otherwise append =X
    return s.endsWith('=X') ? s : `${s}=X`
  }
  return s
}

/**
 * Like getBars but never returns synthetic data — returns [] if real data unavailable.
 * Use this for learning-loop grading to avoid polluting scores with random numbers.
 */
export async function getBarsReal(
  symbol: string,
  startDate: string,
  endDate: string
): Promise<PriceBar[]> {
  const alpacaBars = await fetchAlpacaBars(symbol, startDate, endDate)
  if (alpacaBars.length > 10) return alpacaBars

  const yahooBars = await fetchHistoricalBars(symbol, startDate, endDate)
  if (yahooBars.length > 10) return yahooBars

  return []
}

/**
 * Get bars for multiple symbols — tries real data first, fills missing with synthetic.
 */
export async function getBarsForSymbols(
  symbols: string[],
  startDate: string,
  endDate: string
): Promise<PriceBar[]> {
  // Try Alpaca bulk
  const results = await Promise.allSettled(
    symbols.map(sym => fetchAlpacaBars(sym, startDate, endDate))
  )
  const bars: PriceBar[] = []
  const missing: string[] = []

  for (let i = 0; i < symbols.length; i++) {
    const r = results[i]
    if (r.status === 'fulfilled' && r.value.length > 10) {
      bars.push(...r.value)
    } else {
      missing.push(symbols[i])
    }
  }

  if (missing.length) {
    const yahooBars = await fetchBarsForSymbols(missing, startDate, endDate)
    const gotFromYahoo = new Set(yahooBars.map(b => b.symbol))
    bars.push(...yahooBars)

    for (const sym of missing) {
      if (!gotFromYahoo.has(sym.toUpperCase())) {
        bars.push(...generateSyntheticBars(sym, startDate, endDate))
      }
    }
  }

  return bars
}
