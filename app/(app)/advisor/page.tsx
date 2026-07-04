import { AdvisorClient } from './advisor-client'
import { AdvisoryPanel } from './AdvisoryPanel'
import { WealthCheckupPanel } from './WealthCheckupPanel'
import { TaxCalendarPanel } from './TaxCalendarPanel'
import { GoalsPanel } from './GoalsPanel'
import { BriefPanel } from '@/components/wealth/BriefPanel'
import { getAdvisorClients, getTotalAUM } from '@/lib/actions/household'
import { getAdvisoryView } from '@/lib/actions/advisory'
import { getWealthCheckup } from '@/lib/actions/wealth-checkup'
import { getTaxCalendar } from '@/lib/actions/tax-calendar'
import { getGoalsSummary } from '@/lib/actions/household-goals'
import { getWealthBrief } from '@/lib/actions/wealth-brief'
import { getPlanningView } from '@/lib/actions/planning'
import { PlanningCard } from './PlanningCard'

// Per-user data via cookies — render per-request, never statically.
export const dynamic = 'force-dynamic'

export default async function AdvisorPage() {
  const [clients, totalAUM, advisoryView, checkup, calendar, goals, brief] = await Promise.all([
    getAdvisorClients(),
    getTotalAUM(),
    getAdvisoryView(),
    getWealthCheckup(),
    getTaxCalendar(),
    getGoalsSummary(),
    getWealthBrief().catch(() => null),
  ])
  const planningView = advisoryView
    ? await getPlanningView(advisoryView.recommendations).catch(() => null)
    : null
  return (
    <div className="space-y-6">
      <div className="space-y-4 px-6 pt-6">
        {brief && <BriefPanel brief={brief} />}
        <WealthCheckupPanel checkup={checkup} />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <TaxCalendarPanel view={calendar} />
          <GoalsPanel summary={goals} />
        </div>
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
