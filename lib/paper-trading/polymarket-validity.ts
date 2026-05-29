/**
 * Polymarket market validity gate.
 *
 * Before attempting a paper fill on a Polymarket opportunity, call
 * checkPolymarketValidity(symbol). Expired and resolved markets are the most
 * common source of "no price" noise in the runner logs — catching them here
 * produces a clean, named skip reason rather than a silent broker null.
 */

export type PolymarketSkipCode =
  | 'expired_market'
  | 'resolved_market'
  | 'no_active_book'
  | 'missing_price'
  | 'invalid_slug'

export type PolymarketValidity =
  | { valid: true; price: number }
  | { valid: false; code: PolymarketSkipCode; reason: string }

interface GammaMarket {
  slug?: string
  condition_id?: string
  active?: boolean
  closed?: boolean
  archived?: boolean
  end_date_iso?: string
  endDate?: string
  resolution?: string | null
  outcomePrices?: string[]
  bestBid?: string | null
  bestAsk?: string | null
}

export async function checkPolymarketValidity(symbol: string): Promise<PolymarketValidity> {
  const raw = symbol.startsWith('POLY:') ? symbol.slice(5) : symbol
  if (!raw) return { valid: false, code: 'invalid_slug', reason: 'Empty Polymarket symbol.' }

  const isConditionId = raw.startsWith('0x') && raw.length >= 60
  const url = isConditionId
    ? `https://gamma-api.polymarket.com/markets?condition_id=${encodeURIComponent(raw)}&limit=1`
    : `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(raw)}&limit=1`

  let mkt: GammaMarket | null = null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return { valid: false, code: 'missing_price', reason: `Gamma API ${res.status}.` }
    const markets = await res.json() as GammaMarket[]
    mkt = markets[0] ?? null
  } catch (err) {
    return { valid: false, code: 'missing_price', reason: `Gamma API unreachable: ${err instanceof Error ? err.message : 'timeout'}.` }
  }

  if (!mkt) return { valid: false, code: 'invalid_slug', reason: `Market not found: ${raw}.` }

  // Resolved — already has a final outcome
  if (mkt.resolution != null && mkt.resolution !== '') {
    return { valid: false, code: 'resolved_market', reason: `Market resolved: ${mkt.resolution}.` }
  }

  // Closed / archived
  if (mkt.closed === true || mkt.archived === true) {
    return { valid: false, code: 'resolved_market', reason: 'Market is closed or archived.' }
  }

  // Expired end date (either field name from Gamma API)
  const endIso = mkt.end_date_iso ?? mkt.endDate
  if (endIso) {
    const endMs = new Date(endIso).getTime()
    if (isFinite(endMs) && endMs < Date.now()) {
      return {
        valid: false,
        code: 'expired_market',
        reason: `Market expired ${new Date(endIso).toLocaleDateString()}.`,
      }
    }
  }

  // Active flag explicitly false
  if (mkt.active === false) {
    return { valid: false, code: 'expired_market', reason: 'Market is not active.' }
  }

  // Extract price
  const bid = parseFloat(mkt.bestBid ?? '0')
  const ask = parseFloat(mkt.bestAsk ?? '0')
  if (bid > 0 && ask > 0) return { valid: true, price: (bid + ask) / 2 }

  const rawPrice = mkt.outcomePrices?.[0]
  if (rawPrice != null) {
    const p = parseFloat(rawPrice)
    if (isFinite(p) && p > 0) return { valid: true, price: p }
  }

  return { valid: false, code: 'no_active_book', reason: 'No active order book — market may be thin or just opened.' }
}
