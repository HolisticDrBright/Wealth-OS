import { Topbar } from '@/components/layout/topbar'
import { TradersClient } from './traders-client'
import { getExploreView } from '@/lib/actions/explore'

export default async function TradersPage() {
  const view = await getExploreView()

  return (
    <div>
      <Topbar
        title="Explore — Top Traders"
        subtitle="A small, fenced-off part of your money for copying traders. Your core portfolio is never touched."
      />
      {view ? (
        <TradersClient view={view} />
      ) : (
        <div className="p-6 text-sm text-text-1">
          We couldn&apos;t load traders. Refresh to try again.
        </div>
      )}
    </div>
  )
}
