import { Topbar } from '@/components/layout/topbar'
import { PortfolioClient } from './portfolio-client'
import { getAssets } from '@/lib/actions/assets'
import { mockAssets } from '@/lib/mock-data'

export default async function PortfolioPage() {
  const assetsData = await getAssets()
  const assets = assetsData.length > 0 ? assetsData : mockAssets
  const isDemo = assetsData.length === 0

  return (
    <div>
      <Topbar title="Portfolio" subtitle="Investment positions and performance" />
      <PortfolioClient assets={assets} isDemo={isDemo} />
    </div>
  )
}
