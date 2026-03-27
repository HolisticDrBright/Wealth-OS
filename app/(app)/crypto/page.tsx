import { CryptoClient } from './crypto-client'
import { getCryptoPortfolio, getCryptoPrices } from '@/lib/actions/crypto'

const WATCHED_SYMBOLS = ['BTC', 'ETH', 'SOL', 'MATIC', 'ADA', 'AVAX', 'DOGE', 'DOT']

export default async function CryptoPage() {
  const [portfolio, prices] = await Promise.all([
    getCryptoPortfolio(),
    getCryptoPrices(WATCHED_SYMBOLS),
  ])

  return <CryptoClient initialPortfolio={portfolio} initialPrices={prices} />
}
