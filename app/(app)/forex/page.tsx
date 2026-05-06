import { ForexClient } from './forex-client'
import { getForexRates, getForexPositions } from '@/lib/actions/forex'
import { AssetRiskProfile } from '@/components/risk-profile/AssetRiskProfile'
import { getAssetRiskProfileData } from '@/lib/actions/asset-risk-profile'

export default async function ForexPage() {
  const [rates, positions, riskData] = await Promise.all([
    getForexRates(),
    getForexPositions(),
    getAssetRiskProfileData('forex').catch(() => ({ profiles: [], userProfile: null, strategyDefs: [], migrationApplied: false })),
  ])

  return (
    <div className="space-y-0">
      <div className="px-4 pt-6 max-w-4xl mx-auto">
        <AssetRiskProfile
          assetClass="forex"
          profiles={riskData.profiles}
          userProfile={riskData.userProfile}
          strategyDefs={riskData.strategyDefs}
          migrationApplied={riskData.migrationApplied}
        />
      </div>
      <ForexClient initialRates={rates} initialPositions={positions} />
    </div>
  )
}
