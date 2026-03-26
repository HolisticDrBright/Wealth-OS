import { NextRequest, NextResponse } from 'next/server'
import { fetchStockPrices, fetchCryptoPrices } from '@/lib/prices'
export type { PriceResult } from '@/lib/prices'

export async function POST(req: NextRequest) {
  const { stockSymbols = [], cryptoSymbols = [] } = await req.json()
  const finnhubKey = process.env.FINNHUB_API_KEY ?? ''

  const [stockPrices, cryptoPrices] = await Promise.all([
    fetchStockPrices(stockSymbols, finnhubKey),
    fetchCryptoPrices(cryptoSymbols),
  ])

  return NextResponse.json({
    prices: [...cryptoPrices, ...stockPrices],
    updatedAt: new Date().toISOString(),
  })
}
