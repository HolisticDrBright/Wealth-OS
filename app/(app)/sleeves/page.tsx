import { SleevesClient } from './sleeves-client'
import { getSleeves, getPendingApprovals } from '@/lib/actions/sleeves'

export default async function SleevesPage() {
  const [sleeves, pendingApprovals] = await Promise.all([
    getSleeves(),
    getPendingApprovals(),
  ])
  return <SleevesClient initialSleeves={sleeves} initialPendingApprovals={pendingApprovals} />
}
