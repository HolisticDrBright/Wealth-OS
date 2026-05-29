import { Topbar } from '@/components/layout/topbar'
import { PortfolioClient } from './portfolio-client'
import { getAssets } from '@/lib/actions/assets'
import { getAssetRiskProfileData } from '@/lib/actions/asset-risk-profile'
import { mockAssets } from '@/lib/mock-data'
import { RiskStrip } from '@/components/risk/RiskStrip'
import { CapitalAllocation, type AllocationSlice } from '@/components/portfolio/CapitalAllocation'

export const dynamic = 'force-dynamic'

interface ProfileAllocRow {
  profile_key: string
  alloc_stocks?: number
  alloc_options?: number
  alloc_crypto?: number
  alloc_forex?: number
  alloc_polymarket?: number
  alloc_multi_asset?: number
}

function buildSlices(row: ProfileAllocRow | undefined): AllocationSlice[] {
  return [
    { key: 'stocks',      label: 'Stocks',      recommendedPct: row?.alloc_stocks ?? null,      color: 'bg-indigo-500' },
    { key: 'options',     label: 'Options',     recommendedPct: row?.alloc_options ?? null,     color: 'bg-violet-500' },
    { key: 'crypto',      label: 'Crypto',      recommendedPct: row?.alloc_crypto ?? null,      color: 'bg-amber-500' },
    { key: 'forex',       label: 'Forex',       recommendedPct: row?.alloc_forex ?? null,       color: 'bg-sky-500' },
    { key: 'polymarket',  label: 'Polymarket',  recommendedPct: row?.alloc_polymarket ?? null,  color: 'bg-emerald-500' },
    { key: 'multi_asset', label: 'Multi-Asset', recommendedPct: row?.alloc_multi_asset ?? null, color: 'bg-gray-500' },
  ]
}

export default async function PortfolioPage() {
  const [assetsData, riskData] = await Promise.all([
    getAssets(),
    getAssetRiskProfileData('all').catch(() => ({ profiles: [], userProfile: null, strategyDefs: [], migrationApplied: false })),
  ])
  const assets = assetsData.length > 0 ? assetsData : mockAssets
  const isDemo = assetsData.length === 0

  const profileKey = riskData.userProfile?.profile_key ?? 'balanced'
  const profileRow = (riskData.profiles as ProfileAllocRow[]).find(p => p.profile_key === profileKey)
  const slices = buildSlices(profileRow)
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
