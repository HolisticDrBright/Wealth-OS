import { Topbar } from '@/components/layout/topbar'
import { TradersClient } from './traders-client'
import { getTraders } from '@/lib/actions/traders'

export default async function TradersPage() {
  const traders = await getTraders()

  return (
    <div>
      <Topbar title="Top Traders" subtitle="Follow & copy the best traders across stocks, crypto, forex & Polymarket" />
      <TradersClient traders={traders} />
    </div>
  )
}
