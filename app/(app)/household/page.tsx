import { HouseholdClient } from './household-client'
import { getMyHousehold } from '@/lib/actions/household'

export default async function HouseholdPage() {
  const household = await getMyHousehold()
  return <HouseholdClient initialHousehold={household} />
}
