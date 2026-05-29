/**
 * Polymarket price feed adapter for paper-trading mark-to-market.
 * Fetches current mid-price for a conditionId via the meta-poly sidecar.
 * Symbol format: POLY:<conditionId>
 */

const POLY_PREFIX = 'POLY:'

export function isPolySymbol(symbol: string): boolean {
  return symbol.startsWith(POLY_PREFIX)
}

export function extractConditionId(symbol: string): string {
  return symbol.slice(POLY_PREFIX.length)
}

export async function fetchPolymarketPrice(symbol: string): Promise<number | null> {
  if (!isPolySymbol(symbol)) return null

  const conditionId = extractConditionId(symbol)
  const baseUrl = process.env.META_POLY_BASE_URL
  if (!baseUrl) {
    console.warn('[polymarket-price-feed] META_POLY_BASE_URL not set; cannot mark to market')
    return null
  }

  try {
    const res = await fetch(`${baseUrl}/api/price/${conditionId}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = await res.json() as { mid?: number; price?: number }
    return data.mid ?? data.price ?? null
  } catch {
    return null
  }
}
