import { Topbar } from '@/components/layout/topbar'
import { PortfolioClient } from './portfolio-client'
import { getAssets } from '@/lib/actions/assets'
import { getAssetRiskProfileData } from '@/lib/actions/asset-risk-profile'
import { mockAssets } from '@/lib/mock-data'
import { RiskStrip } from '@/components/risk/RiskStrip'
import { CapitalAllocation } from '@/components/portfolio/CapitalAllocation'
import { policySlices } from '@/components/portfolio/policy-slices'

export const dynamic = 'force-dynamic'

export default async function PortfolioPage() {
  const [assetsData, riskData] = await Promise.all([
    getAssets(),
    getAssetRiskProfileData('all').catch(() => ({ profiles: [], userProfile: null, strategyDefs: [], migrationApplied: false })),
  ])
  const assets = assetsData.length > 0 ? assetsData : mockAssets
  const isDemo = assetsData.length === 0

  // Recommended mix comes from the single allocation policy, not the
  // risk_profiles.alloc_* seed (which recommended crypto/options/forex).
  const slices = policySlices(riskData.userProfile?.profile_key ?? null)
  const hasTargets = slices.some(s => (s.recommendedPct ?? 0) > 0)

  return (
    <div>
      <Topbar title="Portfolio" subtitle="Investment positions and performance" />
      <div className="max-w-4xl mx-auto px-4 pt-4 space-y-3">
        <RiskStrip />
        {hasTargets && <CapitalAllocation slices={slices} currentUnavailable />}
      </div>
      <PortfolioClient assets={assets} isDemo={isDemo} />
    </div>
  )
}
