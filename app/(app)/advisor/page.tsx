import { AdvisorClient } from './advisor-client'
import { AdvisoryPanel } from './AdvisoryPanel'
import { WealthCheckupPanel } from './WealthCheckupPanel'
import { getAdvisorClients, getTotalAUM } from '@/lib/actions/household'
import { getAdvisoryView } from '@/lib/actions/advisory'
import { getWealthCheckup } from '@/lib/actions/wealth-checkup'
import { getPlanningView } from '@/lib/actions/planning'
import { PlanningCard } from './PlanningCard'

// Per-user data via cookies — render per-request, never statically.
export const dynamic = 'force-dynamic'

export default async function AdvisorPage() {
  const [clients, totalAUM, advisoryView, checkup] = await Promise.all([
    getAdvisorClients(),
    getTotalAUM(),
    getAdvisoryView(),
    getWealthCheckup(),
  ])
  const planningView = advisoryView
    ? await getPlanningView(advisoryView.recommendations).catch(() => null)
    : null
  return (
    <div className="space-y-6">
      <div className="space-y-4 px-6 pt-6">
        <WealthCheckupPanel checkup={checkup} />
        {advisoryView && (
          <>
            <PlanningCard view={planningView} />
            <AdvisoryPanel view={advisoryView} />
          </>
        )}
      </div>
      <AdvisorClient initialClients={clients} totalAUM={totalAUM} />
    </div>
  )
}
