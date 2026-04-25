/**
 * Quiver Quant API client.
 * Docs: https://api.quiverquant.com/
 *
 * Endpoints used:
 *   GET /beta/historical/congresstrading/{ticker}
 *   GET /beta/live/congresstrading
 *   GET /beta/historical/govcontracts/{ticker}
 */

export interface CongressTrade {
  Ticker: string
  Representative: string
  Transaction: 'Purchase' | 'Sale (Partial)' | 'Sale (Full)' | 'Exchange'
  Range: string       // e.g. "$15,001 - $50,000"
  TransactionDate: string  // YYYY-MM-DD
  ReportDate: string
  House: 'Senate' | 'House'
  Party?: string
  State?: string
  /** Parsed midpoint of Range in USD */
  amount_usd?: number
}

export interface GovContract {
  Ticker: string
  Amount: number
  Date: string
  Description: string
  Agency: string
}

const BASE = 'https://api.quiverquant.com'

function headers() {
  const key = process.env.QUIVER_QUANT_API_KEY
  if (!key) throw new Error('QUIVER_QUANT_API_KEY not set')
  return { Authorization: `Token ${key}` }
}

/** Parse dollar range string to midpoint. e.g. "$15,001 - $50,000" → 32500 */
function parseRange(range: string): number {
  const nums = range.replace(/[$,]/g, '').match(/\d+/g)?.map(Number) ?? []
  if (nums.length === 0) return 0
  if (nums.length === 1) return nums[0]
  return (nums[0] + nums[1]) / 2
}

/**
 * Fetch live congressional trades (last 30 days across all tickers).
 * Returns sorted by ReportDate descending.
 */
export async function getLiveCongressTrades(): Promise<CongressTrade[]> {
  const key = process.env.QUIVER_QUANT_API_KEY
  if (!key) return []

  try {
    const res = await fetch(`${BASE}/beta/live/congresstrading`, {
      headers: headers(),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    const data: CongressTrade[] = await res.json()
    return data
      .map(t => ({ ...t, amount_usd: parseRange(t.Range) }))
      .sort((a, b) => b.ReportDate.localeCompare(a.ReportDate))
  } catch {
    return []
  }
}

/**
 * Fetch congressional trades for a specific ticker.
 */
export async function getCongressTradesForTicker(ticker: string): Promise<CongressTrade[]> {
  const key = process.env.QUIVER_QUANT_API_KEY
  if (!key) return []

  try {
    const res = await fetch(`${BASE}/beta/historical/congresstrading/${ticker}`, {
      headers: headers(),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    const data: CongressTrade[] = await res.json()
    return data.map(t => ({ ...t, amount_usd: parseRange(t.Range) }))
  } catch {
    return []
  }
}

/**
 * Fetch government contracts for a ticker (bullish signal for defense/gov contractors).
 */
export async function getGovContracts(ticker: string): Promise<GovContract[]> {
  const key = process.env.QUIVER_QUANT_API_KEY
  if (!key) return []

  try {
    const res = await fetch(`${BASE}/beta/historical/govcontracts/${ticker}`, {
      headers: headers(),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

/**
 * Get recent purchases by a specific representative (by name fragment).
 */
export async function getRepresentativeTrades(
  nameFragment: string,
  transactionType: 'Purchase' | 'Sale (Full)' | 'Sale (Partial)' = 'Purchase'
): Promise<CongressTrade[]> {
  const trades = await getLiveCongressTrades()
  return trades.filter(
    t =>
      t.Representative.toLowerCase().includes(nameFragment.toLowerCase()) &&
      t.Transaction === transactionType
  )
}
