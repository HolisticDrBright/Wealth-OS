// Shared price fetching logic used by server action and API route

export interface PriceResult {
  symbol: string
  price: number
  change: number
  changePercent: number
  source: 'finnhub' | 'coingecko' | 'error'
  error?: string
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
