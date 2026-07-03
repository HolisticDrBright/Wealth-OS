/**
 * Funding rate aggregator for perpetual futures.
 *
 * Sources (in priority order):
 *   1. Deribit — /api/v2/public/get_funding_rate_history
 *   2. Binance — /fapi/v1/fundingRate
 *   3. Fallback: zero (signal skipped)
 *
 * Funding rate is expressed as a fraction per 8 hours.
 * Annualised = rate * 3 * 365 (three 8h windows per day).
 */

export interface FundingRate {
  symbol: string      // e.g. "BTC"
  rate: number        // fraction per 8h, e.g. 0.0003 = 0.03%
  annualised: number  // rate * 3 * 365
  timestamp: string
  source: 'deribit' | 'binance' | 'unavailable'
}

async function fromDeribit(symbol: string): Promise<FundingRate | null> {
  try {
    const instrument = `${symbol}-PERPETUAL`
    const end = Date.now()
    const start = end - 8 * 60 * 60 * 1000
    const res = await fetch(
      `https://www.deribit.com/api/v2/public/get_funding_rate_history?instrument_name=${instrument}&start_timestamp=${start}&end_timestamp=${end}`,
      { signal: AbortSignal.timeout(6_000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    const entry = data.result?.[data.result.length - 1]
    if (!entry) return null
    const rate = entry.interest_8h ?? 0
    return {
      symbol,
      rate,
      annualised: rate * 3 * 365,
      timestamp: new Date(entry.timestamp).toISOString(),
      source: 'deribit',
    }
  } catch {
    return null
  }
}

async function fromBinance(symbol: string): Promise<FundingRate | null> {
  try {
    const pair = `${symbol}USDT`
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${pair}&limit=1`,
      { signal: AbortSignal.timeout(6_000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    const entry = data[0]
    if (!entry) return null
    const rate = parseFloat(entry.fundingRate)
    return {
      symbol,
      rate,
      annualised: rate * 3 * 365,
      timestamp: new Date(entry.fundingTime).toISOString(),
      source: 'binance',
    }
  } catch {
    return null
  }
}

/**
 * Get the latest funding rate for a symbol.
 * Tries Deribit first (if we have a Deribit account), then Binance (public API).
 */
export async function getFundingRate(symbol: string): Promise<FundingRate> {
  const result =
    (await fromDeribit(symbol)) ??
    (await fromBinance(symbol)) ??
    { symbol, rate: 0, annualised: 0, timestamp: new Date().toISOString(), source: 'unavailable' as const }

  return result
}

/**
 * Batch fetch funding rates for multiple symbols.
 */
export async function getFundingRates(symbols: string[]): Promise<Map<string, FundingRate>> {
  const results = await Promise.all(symbols.map(s => getFundingRate(s)))
  return new Map(results.map(r => [r.symbol, r]))
}

/**
 * Compute whether basis arb is attractive.
 *
 * Positive funding = longs pay shorts → short perp + long spot is profitable.
 * Negative funding = shorts pay longs → long perp + short spot is profitable.
 *
 * annualisedYield is SIGNED (sign of the funding rate). The carry COLLECTED
 * by the correct side is |annualisedYield| — callers must size on the
 * magnitude and take direction from `side`, never feed the signed value
 * into expected-return math (a long_perp signal would look like a loss).
 *
 * @param rate        8h funding rate (fraction)
 * @param threshold   Minimum 8h rate to trigger signal (default 0.05% = 0.0005)
 */
export function assessBasisArb(
  rate: number,
  threshold = 0.0005
): { viable: boolean; side: 'short_perp' | 'long_perp' | 'neutral'; annualisedYield: number } {
  const annualisedYield = rate * 3 * 365
  if (rate >= threshold) return { viable: true, side: 'short_perp', annualisedYield }
  if (rate <= -threshold) return { viable: true, side: 'long_perp', annualisedYield }
  return { viable: false, side: 'neutral', annualisedYield }
}

/**
 * REAL perpetual mark price — Deribit ticker first, Binance premium index
 * as fallback. Returns null when unavailable; callers must skip the signal
 * rather than fabricate a perp price from the funding rate (that makes any
 * basis check circular).
 */
export async function getPerpMarkPrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://www.deribit.com/api/v2/public/ticker?instrument_name=${symbol}-PERPETUAL`,
      { signal: AbortSignal.timeout(6_000) }
    )
    if (res.ok) {
      const data = await res.json()
      const mark = data.result?.mark_price
      if (typeof mark === 'number' && isFinite(mark) && mark > 0) return mark
    }
  } catch { /* fall through to Binance */ }

  try {
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}USDT`,
      { signal: AbortSignal.timeout(6_000) }
    )
    if (res.ok) {
      const data = await res.json()
      const mark = parseFloat(data.markPrice)
      if (isFinite(mark) && mark > 0) return mark
    }
  } catch { /* unavailable */ }

  return null
}
