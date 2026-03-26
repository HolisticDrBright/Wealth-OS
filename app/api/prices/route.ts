import { NextRequest, NextResponse } from 'next/server'

// CoinGecko symbol → ID map (no API key needed)
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

export interface PriceResult {
  symbol: string
  price: number
  change: number      // $ change today
  changePercent: number  // % change today
  source: 'finnhub' | 'coingecko' | 'error'
  error?: string
}

async function fetchStockPrices(
  symbols: string[],
  apiKey: string
): Promise<PriceResult[]> {
  const results = await Promise.all(
    symbols.map(async (symbol): Promise<PriceResult> => {
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`,
          { next: { revalidate: 60 } }
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!data.c || data.c === 0) throw new Error('No price data')
        return {
          symbol,
          price: data.c,
          change: data.d ?? 0,
          changePercent: data.dp ?? 0,
          source: 'finnhub',
        }
      } catch (err) {
        return { symbol, price: 0, change: 0, changePercent: 0, source: 'error', error: String(err) }
      }
    })
  )
  return results
}

async function fetchCryptoPrices(symbols: string[]): Promise<PriceResult[]> {
  const ids = symbols
    .map(s => CRYPTO_ID_MAP[s.toUpperCase()])
    .filter(Boolean)

  if (ids.length === 0) return []

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`,
      { next: { revalidate: 60 } }
    )
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`)
    const data = await res.json()

    return symbols.map((symbol): PriceResult => {
      const id = CRYPTO_ID_MAP[symbol.toUpperCase()]
      if (!id || !data[id]) {
        return { symbol, price: 0, change: 0, changePercent: 0, source: 'error', error: 'Not found' }
      }
      const price = data[id].usd ?? 0
      const changePercent = data[id].usd_24h_change ?? 0
      return {
        symbol,
        price,
        change: (price * changePercent) / (100 + changePercent),
        changePercent,
        source: 'coingecko',
      }
    })
  } catch (err) {
    return symbols.map(symbol => ({
      symbol, price: 0, change: 0, changePercent: 0, source: 'error' as const, error: String(err),
    }))
  }
}

export async function POST(req: NextRequest) {
  const finnhubKey = process.env.FINNHUB_API_KEY
  const { stockSymbols = [], cryptoSymbols = [] } = await req.json()

  const results: PriceResult[] = []

  if (cryptoSymbols.length > 0) {
    const cryptoPrices = await fetchCryptoPrices(cryptoSymbols)
    results.push(...cryptoPrices)
  }

  if (stockSymbols.length > 0) {
    if (!finnhubKey) {
      stockSymbols.forEach((symbol: string) => {
        results.push({ symbol, price: 0, change: 0, changePercent: 0, source: 'error', error: 'FINNHUB_API_KEY not set' })
      })
    } else {
      const stockPrices = await fetchStockPrices(stockSymbols, finnhubKey)
      results.push(...stockPrices)
    }
  }

  return NextResponse.json({ prices: results, updatedAt: new Date().toISOString() })
}
