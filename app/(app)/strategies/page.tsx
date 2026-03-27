import { StrategiesClient } from './strategies-client'
import { getStrategies } from '@/lib/actions/strategies'

export default async function StrategiesPage() {
  const strategies = await getStrategies()
  return <StrategiesClient initialStrategies={strategies} />
}
