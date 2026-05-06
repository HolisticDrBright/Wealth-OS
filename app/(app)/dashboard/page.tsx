import { Topbar } from '@/components/layout/topbar'
import { DashboardClient } from './dashboard-client'
import { getAssets } from '@/lib/actions/assets'
import { getTransactions } from '@/lib/actions/transactions'
import { getNetWorthHistory } from '@/lib/actions/networth'
import { getUserRiskProfile } from '@/lib/actions/risk-profile'
import { ProfileBadge } from '@/components/risk-profile/ProfileBadge'
import { AssetRiskProfile } from '@/components/risk-profile/AssetRiskProfile'
import { getAssetRiskProfileData } from '@/lib/actions/asset-risk-profile'
import {
  mockNetWorthHistory,
  mockAssets,
  mockTransactions,
} from '@/lib/mock-data'
import type { ProfileKey } from '@/lib/strategies/profile-params'

export default async function DashboardPage() {
  const [assetsData, transactionsData, netWorthData, riskProfile, riskData] = await Promise.all([
    getAssets(),
    getTransactions(),
    getNetWorthHistory(),
    getUserRiskProfile().catch(() => null),
    getAssetRiskProfileData('all').catch(() => null),
  ])

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
      {riskData && (
        <div className="px-6 pt-4 pb-2 max-w-4xl">
          <AssetRiskProfile
            assetClass="all"
            profiles={riskData.profiles}
            userProfile={riskData.userProfile}
            strategyDefs={riskData.strategyDefs}
            migrationApplied={riskData.migrationApplied}
          />
        </div>
      )}
      <DashboardClient
        assets={assets}
        transactions={transactions}
        netWorthHistory={netWorthHistory}
        isDemo={isDemo}
      />
    </div>
  )
}
