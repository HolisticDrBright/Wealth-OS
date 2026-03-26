// Shared price fetching logic used by server action and API route

export interface PriceResult {
  symbol: string
  price: number
  change: number
  changePercent: number
  source: 'finnhub' | 'coingecko' | 'coinstats' | 'error'
  error?: string
  marketCap?: number
  volume24h?: number
}

// ─── CoinStats enrichment ─────────────────────────────────────────────────

const COINSTATS_ID_MAP: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', ADA: 'cardano',
  DOT: 'polkadot', DOGE: 'dogecoin', AVAX: 'avalanche', MATIC: 'polygon',
  LINK: 'chainlink', UNI: 'uniswap', LTC: 'litecoin', XRP: 'xrp',
  BNB: 'bnb', ATOM: 'cosmos', SHIB: 'shiba-inu', NEAR: 'near-protocol',
  APT: 'aptos', ARB: 'arbitrum', WIF: 'dogwifhat',
}

export async function fetchCoinStatsPrices(symbols: string[]): Promise<PriceResult[]> {
  const apiKey = process.env.COINSTATS_API_KEY
  if (!apiKey || symbols.length === 0) return []

  try {
    const res = await fetch('https://openapiv1.coinstats.app/coins?limit=100', {
      headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`CoinStats ${res.status}`)
    const { result } = await res.json() as { result: Array<{ symbol: string; price: number; priceChange1d: number; marketCap: number; volume: number }> }

    const priceMap = new Map(result.map(c => [c.symbol.toUpperCase(), c]))

    return symbols.map((symbol): PriceResult => {
      const coin = priceMap.get(symbol.toUpperCase())
      if (!coin) return { symbol, price: 0, change: 0, changePercent: 0, source: 'error', error: 'Not found in CoinStats' }
      return {
        symbol,
        price: coin.price,
        change: (coin.price * coin.priceChange1d) / (100 + coin.priceChange1d),
        changePercent: coin.priceChange1d,
        marketCap: coin.marketCap,
        volume24h: coin.volume,
        source: 'coinstats',
      }
    })
  } catch (err) {
    return symbols.map(s => ({ symbol: s, price: 0, change: 0, changePercent: 0, source: 'error' as const, error: String(err) }))
  }
}

const CRYPTO_ID_MAP: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  ADA: 'cardano',
  DOT: 'polkadot',
  DOGE: 'dogecoin',
  AVAX: 'avalanche-2',
  MATIC: 'matic-network',
  LINK: 'chainlink',
  UNI: 'uniswap',
  LTC: 'litecoin',
  XRP: 'ripple',
  BNB: 'binancecoin',
  ATOM: 'cosmos',
  FIL: 'filecoin',
  AAVE: 'aave',
  SHIB: 'shiba-inu',
  NEAR: 'near',
  APT: 'aptos',
  ARB: 'arbitrum',
}

export const CRYPTO_SYMBOLS = new Set(Object.keys(CRYPTO_ID_MAP))

export async function fetchStockPrices(symbols: string[], apiKey: string): Promise<PriceResult[]> {
  if (!apiKey || symbols.length === 0) return []
  return Promise.all(
    symbols.map(async (symbol): Promise<PriceResult> => {
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`,
          { cache: 'no-store' }
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!data.c || data.c === 0) throw new Error('No price returned — check symbol or API key')
        return { symbol, price: data.c, change: data.d ?? 0, changePercent: data.dp ?? 0, source: 'finnhub' }
      } catch (err) {
        return { symbol, price: 0, change: 0, changePercent: 0, source: 'error', error: String(err) }
      }
    })
  )
}

export async function fetchCryptoPrices(symbols: string[]): Promise<PriceResult[]> {
  if (symbols.length === 0) return []

  // Try CoinStats first if API key is configured
  if (process.env.COINSTATS_API_KEY) {
    const results = await fetchCoinStatsPrices(symbols)
    if (results.some(r => r.source === 'coinstats')) return results
  }

  // Fall back to CoinGecko
  const ids = symbols.map(s => CRYPTO_ID_MAP[s.toUpperCase()]).filter(Boolean)
  if (ids.length === 0) return symbols.map(symbol => ({ symbol, price: 0, change: 0, changePercent: 0, source: 'error' as const, error: 'Unknown symbol' }))

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`,
      { cache: 'no-store' }
    )
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`)
    const data = await res.json()

    return symbols.map((symbol): PriceResult => {
      const id = CRYPTO_ID_MAP[symbol.toUpperCase()]
      if (!id || !data[id]) return { symbol, price: 0, change: 0, changePercent: 0, source: 'error', error: 'Not in response' }
      const price = data[id].usd ?? 0
      const changePercent = data[id].usd_24h_change ?? 0
      return { symbol, price, change: (price * changePercent) / (100 + changePercent), changePercent, source: 'coingecko' }
    })
  } catch (err) {
    return symbols.map(symbol => ({ symbol, price: 0, change: 0, changePercent: 0, source: 'error' as const, error: String(err) }))
  }
}
