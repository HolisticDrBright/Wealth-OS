import { Topbar } from '@/components/layout/topbar'
import TaxClient from './tax-client'
import { TaxLossSummaryCard } from './tax-loss-summary-card'
import { getAssets } from '@/lib/actions/assets'
import { getTransactions } from '@/lib/actions/transactions'
import { getGoals } from '@/lib/actions/goals'
import { getTaxLossSummary } from '@/lib/actions/tax-ledger'
import { mockAssets, mockTransactions, mockGoals } from '@/lib/mock-data'

export default async function TaxPage() {
  const [assets, transactions, goals, taxLossSummary] = await Promise.all([
    getAssets(),
    getTransactions(),
    getGoals(),
    getTaxLossSummary(),
  ])

  const hasData = assets.length > 0 || transactions.length > 0

  return (
    <div>
      <Topbar
        title="AI Tax Advisor"
        subtitle="Personalized tax strategies powered by Claude"
      />
      <TaxLossSummaryCard summary={taxLossSummary} />
      <TaxClient
        assets={hasData ? assets : mockAssets}
        transactions={hasData ? transactions : mockTransactions}
        goals={hasData ? goals : mockGoals}
      />
    </div>
  )
}
