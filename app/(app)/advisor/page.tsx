import { AdvisorClient } from './advisor-client'
import { AdvisoryPanel } from './AdvisoryPanel'
import { getAdvisorClients, getTotalAUM } from '@/lib/actions/household'
import { getAdvisoryView } from '@/lib/actions/advisory'

// Per-user data via cookies — render per-request, never statically.
export const dynamic = 'force-dynamic'

export default async function AdvisorPage() {
  const [clients, totalAUM, advisoryView] = await Promise.all([
    getAdvisorClients(),
    getTotalAUM(),
    getAdvisoryView(),
  ])
  return (
    <div className="space-y-6">
      {advisoryView && (
        <div className="px-6 pt-6">
          <AdvisoryPanel view={advisoryView} />
        </div>
      )}
      <AdvisorClient initialClients={clients} totalAUM={totalAUM} />
    </div>
  )
}
