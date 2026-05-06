import { CryptoClient } from './crypto-client'
import { getCryptoPortfolio, getCryptoPrices } from '@/lib/actions/crypto'
import { AssetRiskProfile } from '@/components/risk-profile/AssetRiskProfile'
import { getAssetRiskProfileData } from '@/lib/actions/asset-risk-profile'

const WATCHED_SYMBOLS = ['BTC', 'ETH', 'SOL', 'MATIC', 'ADA', 'AVAX', 'DOGE', 'DOT']

export default async function CryptoPage() {
  const [portfolio, prices, riskData] = await Promise.all([
    getCryptoPortfolio(),
    getCryptoPrices(WATCHED_SYMBOLS),
    getAssetRiskProfileData('crypto').catch(() => ({ profiles: [], userProfile: null, strategyDefs: [], migrationApplied: false })),
  ])

  return (
    <div className="space-y-0">
      <div className="px-4 pt-6 max-w-4xl mx-auto">
        <AssetRiskProfile
          assetClass="crypto"
          profiles={riskData.profiles}
          userProfile={riskData.userProfile}
          strategyDefs={riskData.strategyDefs}
          migrationApplied={riskData.migrationApplied}
        />
      </div>
      <CryptoClient initialPortfolio={portfolio} initialPrices={prices} />
    </div>
  )
}
