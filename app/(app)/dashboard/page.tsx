import { Topbar } from '@/components/layout/topbar'
import { DashboardClient } from './dashboard-client'
import { getAssets } from '@/lib/actions/assets'
import { getTransactions } from '@/lib/actions/transactions'
import { getNetWorthHistory } from '@/lib/actions/networth'
import { getUserRiskProfile } from '@/lib/actions/risk-profile'
import { ProfileBadge } from '@/components/risk-profile/ProfileBadge'
import {
  mockNetWorthHistory,
  mockAssets,
  mockTransactions,
} from '@/lib/mock-data'
import type { ProfileKey } from '@/lib/strategies/profile-params'

export default async function DashboardPage() {
  const [assetsData, transactionsData, netWorthData, riskProfile] = await Promise.all([
    getAssets(),
    getTransactions(),
    getNetWorthHistory(),
    getUserRiskProfile().catch(() => null),
  ])

  // Fall back to mock data if the user has no data yet
  const assets = assetsData.length > 0 ? assetsData : mockAssets
  const transactions = transactionsData.length > 0 ? transactionsData : mockTransactions
  const netWorthHistory = netWorthData.length > 0 ? netWorthData : mockNetWorthHistory
  const isDemo = assetsData.length === 0
  const profileKey: ProfileKey = riskProfile?.profileKey ?? 'balanced'

  return (
    <div>
      <Topbar
        title="Dashboard"
        subtitle="Financial Overview"
        badge={<ProfileBadge profile={profileKey} />}
      />
      <DashboardClient
        assets={assets}
        transactions={transactions}
        netWorthHistory={netWorthHistory}
        isDemo={isDemo}
      />
    </div>
  )
}
