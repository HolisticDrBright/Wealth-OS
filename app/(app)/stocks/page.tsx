import { AssetStrategyPanel } from '@/components/trading/AssetStrategyPanel'
import { AssetRiskProfile } from '@/components/risk-profile/AssetRiskProfile'
import { getAssetRiskProfileData } from '@/lib/actions/asset-risk-profile'
import { RiskStrip } from '@/components/risk/RiskStrip'

const EMPTY_RISK_DATA = { profiles: [], userProfile: null, strategyDefs: [], migrationApplied: false }

export default async function StocksPage() {
  const riskData = await getAssetRiskProfileData('stocks').catch(() => EMPTY_RISK_DATA)

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Stocks</h1>
        <p className="text-sm text-gray-500 mt-1">
          Momentum, value, dividend, sector rotation, earnings drift, merger arb, and spinoff strategies
        </p>
      </div>

      <RiskStrip />

      <AssetRiskProfile
        assetClass="stocks"
        profiles={riskData.profiles}
        userProfile={riskData.userProfile}
        strategyDefs={riskData.strategyDefs}
        migrationApplied={riskData.migrationApplied}
      />

      <AssetStrategyPanel assetClasses={['stocks']} userProfileKey={(riskData.userProfile?.profile_key as import('@/lib/strategies/strategy-registry').ProfileKey) ?? undefined} />
    </div>
  )
}
