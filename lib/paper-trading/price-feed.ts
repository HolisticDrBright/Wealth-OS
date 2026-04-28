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
      case 'multi-asset': {
        // Forex pairs (EUR_USD, EUR/USD) route to fetchForexPrice; stocks route to fetchStockPrice
        const fxPairRe = /^[A-Za-z]{3}[_/][A-Za-z]{3}$/
        return fxPairRe.test(symbol)
          ? await fetchForexPrice(symbol)
          : await fetchStockPrice(symbol)
      }
      default:            return null
    }
  } catch {
    return null
  }
}

// ─── Crypto — Coinbase public REST with CoinGecko fallback ──────────────────

const COINGECKO_ID: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple',
  ADA: 'cardano', DOGE: 'dogecoin', AVAX: 'avalanche-2', DOT: 'polkadot',
  LINK: 'chainlink', MATIC: 'matic-network', UNI: 'uniswap',
}

async function fetchCryptoPrice(symbol: string): Promise<number | null> {
  // Normalise: BTC-ARB → BTC, ETH-USD → ETH, SOL → SOL
  const base = symbol
    .replace(/-ARB$/, '')
    .replace(/-(?:USD|USDT|USDC|PERP)$/, '')
    .toUpperCase()

  // Try Coinbase first
  try {
    const res = await fetch(
      `https://api.coinbase.com/api/v3/brokerage/best_bid_ask?product_ids=${base}-USD`,
      { signal: AbortSignal.timeout(3_000) }
    )
    if (res.ok) {
      const data = await res.json() as {
        pricebooks?: Array<{ bids: Array<{ price: string }>; asks: Array<{ price: string }> }>
      }
      const pb = data.pricebooks?.[0]
      if (pb) {
        const bid = parseFloat(pb.bids[0]?.price ?? '0')
        const ask = parseFloat(pb.asks[0]?.price ?? '0')
        if (bid > 0 && ask > 0) return (bid + ask) / 2
      }
    }
  } catch { /* fall through */ }

  // Fallback: CoinGecko simple price (no API key required)
  const geckoId = COINGECKO_ID[base]
  if (!geckoId) return null
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${geckoId}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(5_000) }
    )
    if (!res.ok) return null
    const data = await res.json() as Record<string, { usd?: number }>
    return data[geckoId]?.usd ?? null
  } catch {
    return null
  }
}

// ─── Stocks — Yahoo Finance v8 (no key required) ────────────────────────────

// Map synthetic/index symbols to Yahoo Finance tickers
const YAHOO_TICKER_MAP: Record<string, string> = {
  'VIX': '^VIX',
}

async function fetchStockPrice(symbol: string): Promise<number | null> {
  // Strip option suffixes: AAPL-call → AAPL, VIX-SHORT → VIX → ^VIX
  const raw = symbol.split(/[-/]/)[0].toUpperCase()
  const ticker = YAHOO_TICKER_MAP[raw] ?? raw

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
  // Accepts EUR-USD, EUR/USD, EUR_USD, EURUSD
  const clean = symbol.replace(/[/_]/g, '-')
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
  // Strip POLY: prefix added by strategy opportunity builders
  const raw = symbol.startsWith('POLY:') ? symbol.slice(5) : symbol

  // conditionId is a hex string starting with 0x; everything else is treated as a slug
  const isConditionId = raw.startsWith('0x') && raw.length >= 60
  const url = isConditionId
    ? `https://gamma-api.polymarket.com/markets?condition_id=${encodeURIComponent(raw)}&limit=1`
    : `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(raw)}&limit=1`

  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
  if (!res.ok) return null

  const markets = await res.json() as Array<{ outcomePrices?: string[]; bestBid?: string; bestAsk?: string }>
  const mkt = markets[0]
  if (!mkt) return null

  // Prefer mid from bestBid/bestAsk; fall back to outcomePrices YES price
  const bid = parseFloat(mkt.bestBid ?? '0')
  const ask = parseFloat(mkt.bestAsk ?? '0')
  if (bid > 0 && ask > 0) return (bid + ask) / 2

  const rawPrice = mkt.outcomePrices?.[0]
  if (rawPrice == null) return null
  const parsed = parseFloat(rawPrice)
  return isFinite(parsed) && parsed > 0 ? parsed : null
}
