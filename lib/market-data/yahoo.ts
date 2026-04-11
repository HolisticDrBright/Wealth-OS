/**
 * Yahoo Finance historical OHLCV via yahoo-finance2 (no API key required).
 * Used as the primary source for backtest bars and portfolio history.
 *
 * Docs: https://yahoo-finance2.doublesharp.com/
 */
import yahooFinance from 'yahoo-finance2'
import type { PriceBar } from '@/lib/backtester'

export interface YahooQuote {
  symbol: string
  price: number
  change: number
  changePct: number
  volume: number
  marketCap?: number
  high52w?: number
  low52w?: number
  pe?: number
  eps?: number
  name?: string
  exchange?: string
}

/** Fetch historical daily OHLCV bars for one symbol. */
export async function fetchHistoricalBars(
  symbol: string,
  startDate: string,
  endDate: string
): Promise<PriceBar[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await (yahooFinance as any).chart(symbol, {
      period1: startDate,
      period2: endDate,
      interval: '1d',
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quotes: any[] = result?.quotes ?? []
    return quotes
      .filter((q: any) => q.open != null && q.close != null)
      .map((q: any) => ({
        date: new Date(q.date).toISOString().slice(0, 10),
        symbol: symbol.toUpperCase(),
        open: q.open,
        high: q.high ?? q.close,
        low: q.low ?? q.close,
        close: q.close,
        volume: q.volume ?? 0,
      }))
  } catch {
    return []
  }
}

/** Fetch bars for multiple symbols — returns flat array ready for the backtester. */
export async function fetchBarsForSymbols(
  symbols: string[],
  startDate: string,
  endDate: string
): Promise<PriceBar[]> {
  const results = await Promise.allSettled(
    symbols.map(sym => fetchHistoricalBars(sym, startDate, endDate))
  )
  return results
    .filter((r): r is PromiseFulfilledResult<PriceBar[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)
}

/** Get a live/delayed quote for one symbol. */
export async function fetchYahooQuote(symbol: string): Promise<YahooQuote | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = await (yahooFinance as any).quote(symbol)
    if (!q) return null
    return {
      symbol: symbol.toUpperCase(),
      price: q.regularMarketPrice ?? 0,
      change: q.regularMarketChange ?? 0,
      changePct: q.regularMarketChangePercent ?? 0,
      volume: q.regularMarketVolume ?? 0,
      marketCap: q.marketCap,
      high52w: q.fiftyTwoWeekHigh,
      low52w: q.fiftyTwoWeekLow,
      pe: q.trailingPE,
      eps: q.epsTrailingTwelveMonths,
      name: q.shortName ?? q.longName,
      exchange: q.fullExchangeName,
    }
  } catch {
    return null
  }
}

/** Get quotes for multiple symbols. */
export async function fetchYahooQuotes(symbols: string[]): Promise<YahooQuote[]> {
  const results = await Promise.allSettled(symbols.map(fetchYahooQuote))
  return results
    .filter((r): r is PromiseFulfilledResult<YahooQuote | null> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter((q): q is YahooQuote => q !== null)
}
