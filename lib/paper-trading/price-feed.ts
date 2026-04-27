import type { AssetClass } from '@/lib/strategies/strategy-registry'

/**
 * Fetch the current mid-price for a symbol using free public APIs.
 * Crypto:      Coinbase public best_bid_ask
 * Stocks:      Yahoo Finance v8 chart endpoint
 * Forex:       open.er-api.com free tier
 * Polymarket:  Gamma API market prices
 * Returns null on any failure — callers should treat null as "skip this fill".
 */
export async function fetchCurrentPrice(
  symbol: string,
  assetClass: AssetClass
): Promise<number | null> {
  try {
    switch (assetClass) {
      case 'crypto':      return await fetchCryptoPrice(symbol)
      case 'stocks':
      case 'options':     return await fetchStockPrice(symbol)
      case 'forex':       return await fetchForexPrice(symbol)
      case 'polymarket':  return await fetchPolymarketPrice(symbol)
      case 'multi-asset': return await fetchStockPrice(symbol)
      default:            return null
    }
  } catch {
    return null
  }
}

// ─── Crypto — Coinbase public REST (no key required) ────────────────────────

async function fetchCryptoPrice(symbol: string): Promise<number | null> {
  // Normalise: BTC-ARB → BTC, ETH-USD → ETH, SOL → SOL
  const base = symbol
    .replace(/-ARB$/, '')
    .replace(/-(?:USD|USDT|USDC|PERP)$/, '')
    .toUpperCase()
  const productId = `${base}-USD`

  const res = await fetch(
    `https://api.coinbase.com/api/v3/brokerage/best_bid_ask?product_ids=${productId}`,
    { signal: AbortSignal.timeout(3_000) }
  )
  if (!res.ok) return null

  const data = await res.json() as {
    pricebooks?: Array<{
      bids: Array<{ price: string }>
      asks: Array<{ price: string }>
    }>
  }
  const pb = data.pricebooks?.[0]
  if (!pb) return null

  const bid = parseFloat(pb.bids[0]?.price ?? '0')
  const ask = parseFloat(pb.asks[0]?.price ?? '0')
  return bid > 0 && ask > 0 ? (bid + ask) / 2 : null
}

// ─── Stocks — Yahoo Finance v8 (no key required) ────────────────────────────

async function fetchStockPrice(symbol: string): Promise<number | null> {
  // Strip option suffixes: AAPL-call → AAPL
  const ticker = symbol.split(/[-/]/)[0].toUpperCase()

  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`,
    { signal: AbortSignal.timeout(5_000) }
  )
  if (!res.ok) return null

  const data = await res.json() as {
    chart?: { result?: Array<{ meta: { regularMarketPrice: number } }> }
  }
  return data.chart?.result?.[0]?.meta?.regularMarketPrice ?? null
}

// ─── Forex — ExchangeRate API free tier (no key required) ───────────────────

async function fetchForexPrice(symbol: string): Promise<number | null> {
  // Accepts EUR-USD, EUR/USD, EURUSD
  const clean = symbol.replace('/', '-')
  const parts = clean.includes('-') ? clean.split('-') : [clean.slice(0, 3), clean.slice(3)]
  const [base, quote = 'USD'] = parts

  const res = await fetch(
    `https://open.er-api.com/v6/latest/${base.toUpperCase()}`,
    { signal: AbortSignal.timeout(5_000) }
  )
  if (!res.ok) return null

  const data = await res.json() as { rates?: Record<string, number> }
  return data.rates?.[quote.toUpperCase()] ?? null
}

// ─── Polymarket — Gamma API (no key required) ────────────────────────────────

async function fetchPolymarketPrice(symbol: string): Promise<number | null> {
  // symbol is either a market slug or a conditionId
  const isSlug = !symbol.startsWith('0x') && symbol.length < 80

  const url = isSlug
    ? `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(symbol)}&limit=1`
    : `https://gamma-api.polymarket.com/markets?clob_token_ids=${encodeURIComponent(symbol)}&limit=1`

  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
  if (!res.ok) return null

  const markets = await res.json() as Array<{ outcomePrices?: string[] }>
  const price = markets[0]?.outcomePrices?.[0]
  return price != null ? parseFloat(price) : null
}
