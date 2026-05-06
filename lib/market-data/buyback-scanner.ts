/**
 * Buyback announcement scanner — screens SEC 8-K filings for share repurchase
 * program disclosures. Uses EDGAR full-text search (no key required).
 */

export interface BuybackAnnouncement {
  ticker: string
  size_usd: number        // announced program size in USD
  announced_at: string    // ISO date
  is_extension: boolean   // true if extending existing program
  is_secondary_offering: boolean
}

export interface TickerMeta {
  last_close: number
  market_cap: number
  profit_margin: number   // 0-1; negative means loss
}

const EDGAR_SEARCH = 'https://efts.sec.gov/LATEST/search-index'

/**
 * Scan recent 8-K filings for share repurchase disclosures.
 * Returns buyback announcements from the last `withinHours` hours.
 */
export async function fetchBuybackAnnouncements(params: {
  withinHours?: number
}): Promise<BuybackAnnouncement[]> {
  try {
    const hours = params.withinHours ?? 24
    const startDate = new Date(Date.now() - hours * 3_600_000).toISOString().split('T')[0]
    // Item 8.01 = Other Events (often used for buyback), Item 7.01 = Regulation FD
    const url = `${EDGAR_SEARCH}?q=${encodeURIComponent('repurchase program')}&forms=8-K&dateRange=custom&startdt=${startDate}`

    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return []
    const data: unknown = await res.json()
    const hits = ((data as Record<string, unknown>)?.hits as Record<string, unknown>)?.hits as unknown[] ?? []

    return hits.slice(0, 20).map((h: unknown) => {
      const src = ((h as Record<string, unknown>)?._source as Record<string, unknown>) ?? {}
      return {
        ticker: (src.entity_name as string | undefined) ?? 'UNKNOWN',
        size_usd: 0,            // requires parsing the actual 8-K text
        announced_at: (src.file_date as string | undefined) ?? new Date().toISOString(),
        is_extension: false,    // requires NLP on filing text
        is_secondary_offering: false,
      }
    })
  } catch {
    return []
  }
}

/**
 * Fetch basic ticker metadata from Yahoo Finance (public, no key).
 * Returns null when the ticker is unavailable.
 */
export async function getTickerMeta(ticker: string): Promise<TickerMeta | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000) })
    if (!res.ok) return null
    const data: unknown = await res.json()

    const result = ((data as Record<string, unknown>)?.chart as Record<string, unknown>)
      ?.result as unknown[]
    if (!result?.[0]) return null

    const meta = (result[0] as Record<string, unknown>).meta as Record<string, unknown> | undefined
    const lastClose = (meta?.regularMarketPrice as number | undefined) ?? 0
    const sharesOut = (meta?.sharesOutstanding as number | undefined) ?? 0

    return {
      last_close: lastClose,
      market_cap: lastClose * sharesOut,
      profit_margin: 0,   // not available from chart endpoint — requires financials
    }
  } catch {
    return null
  }
}

/**
 * Check if a ticker has a concurrent secondary offering (dilutive, opposes buyback).
 * Placeholder: requires SEC S-3 filing scan.
 */
export async function hasSimultaneousSecondaryOffering(_ticker: string): Promise<boolean> {
  return false
}

/**
 * Check whether the buyback is an extension of an existing program.
 * Placeholder: requires NLP on 8-K text.
 */
export async function isExtensionOfExistingProgram(_ticker: string): Promise<boolean> {
  return false
}

/**
 * Check whether the buyback is debt-funded (reduces credit quality).
 * Placeholder: requires balance sheet analysis.
 */
export async function checkDebtFunded(_ticker: string, _sizeUsd: number): Promise<boolean> {
  return false
}
