import { AdvisorClient } from './advisor-client'
import { getAdvisorClients, getTotalAUM } from '@/lib/actions/household'

export default async function AdvisorPage() {
  const [clients, totalAUM] = await Promise.all([
    getAdvisorClients(),
    getTotalAUM(),
  ])
  return <AdvisorClient initialClients={clients} totalAUM={totalAUM} />
}
