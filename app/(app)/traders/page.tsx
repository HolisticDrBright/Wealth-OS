import { Topbar } from '@/components/layout/topbar'
import { TradersClient } from './traders-client'
import { getExploreView } from '@/lib/actions/explore'
import { getExploreVsCore } from '@/lib/actions/explore-vs-core'
import { ExploreVsCoreCard } from './ExploreVsCoreCard'

export default async function TradersPage() {
  const [view, vsCore] = await Promise.all([getExploreView(), getExploreVsCore()])

  return (
    <div>
      <Topbar
        title="Explore — Top Traders"
        subtitle="A small, fenced-off part of your money for copying traders. Your core portfolio is never touched."
      />
      {vsCore && view && (
        <div className="px-6 pt-4">
          <ExploreVsCoreCard view={vsCore} uiMode={view.uiMode === 'pro' ? 'pro' : 'simple'} />
        </div>
      )}
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
