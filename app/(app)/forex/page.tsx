import { ForexClient } from './forex-client'
import { getForexRates, getForexPositions } from '@/lib/actions/forex'

export default async function ForexPage() {
  const [rates, positions] = await Promise.all([
    getForexRates(),
    getForexPositions(),
  ])

  return <ForexClient initialRates={rates} initialPositions={positions} />
}
