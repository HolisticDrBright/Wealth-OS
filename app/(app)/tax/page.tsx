import { Topbar } from '@/components/layout/topbar'
import TaxClient from './tax-client'
import { getAssets } from '@/lib/actions/assets'
import { getTransactions } from '@/lib/actions/transactions'
import { getGoals } from '@/lib/actions/goals'
import { mockAssets, mockTransactions, mockGoals } from '@/lib/mock-data'

export default async function TaxPage() {
  const [assets, transactions, goals] = await Promise.all([
    getAssets(),
    getTransactions(),
    getGoals(),
  ])

  const hasData = assets.length > 0 || transactions.length > 0

  return (
    <div>
      <Topbar
        title="AI Tax Advisor"
        subtitle="Personalized tax strategies powered by Claude"
      />
      <TaxClient
        assets={hasData ? assets : mockAssets}
        transactions={hasData ? transactions : mockTransactions}
        goals={hasData ? goals : mockGoals}
      />
    </div>
  )
}
