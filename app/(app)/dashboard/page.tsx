import { Topbar } from '@/components/layout/topbar'
import { DashboardClient } from './dashboard-client'
import { getAssets } from '@/lib/actions/assets'
import { getTransactions } from '@/lib/actions/transactions'
import { getNetWorthHistory } from '@/lib/actions/networth'
import {
  mockNetWorthHistory,
  mockAssets,
  mockTransactions,
} from '@/lib/mock-data'

export default async function DashboardPage() {
  const [assetsData, transactionsData, netWorthData] = await Promise.all([
    getAssets(),
    getTransactions(),
    getNetWorthHistory(),
  ])

  // Fall back to mock data if the user has no data yet
  const assets = assetsData.length > 0 ? assetsData : mockAssets
  const transactions = transactionsData.length > 0 ? transactionsData : mockTransactions
  const netWorthHistory = netWorthData.length > 0 ? netWorthData : mockNetWorthHistory
  const isDemo = assetsData.length === 0

  return (
    <div>
      <Topbar title="Dashboard" subtitle="Financial Overview" />
      <DashboardClient
        assets={assets}
        transactions={transactions}
        netWorthHistory={netWorthHistory}
        isDemo={isDemo}
      />
    </div>
  )
}
