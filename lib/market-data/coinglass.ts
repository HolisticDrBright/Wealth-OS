/**
 * CoinGlass public funding rate data.
 * Falls back gracefully when the API is unavailable or rate-limited.
 */

const BASE = 'https://open-api.coinglass.com/public/v2'

export interface CoinGlassFunding {
  symbol: string
  fundingRate: number    // current 8h rate
  fundingApr: number     // annualised %  (rate * 3 * 365)
  nextFundingTime: number  // ms epoch
}

/** Fetch annualised funding APR for a perp symbol (e.g. 'BTCUSDT'). */
export async function getFundingApr(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${BASE}/funding?symbol=${symbol}`,
      { signal: AbortSignal.timeout(5_000) }
    )
    if (!res.ok) return null
    const data = await res.json() as { code?: number; data?: { fundingRate?: number } }
    if (data.code !== 0 || !data.data?.fundingRate) return null
    const rate = data.data.fundingRate
    return rate * 3 * 365  // 3 settlements/day × 365 = annualised
  } catch {
    return null
  }
}

/**
 * Fetch funding APR for multiple symbols. Returns a map symbol -> APR.
 * Symbols that fail return null.
 */
export async function getBatchFundingApr(
  symbols: string[]
): Promise<Map<string, number | null>> {
  const results = await Promise.all(
    symbols.map(async s => [s, await getFundingApr(s)] as [string, number | null])
  )
  return new Map(results)
}
