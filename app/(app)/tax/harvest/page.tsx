import { HarvestClient } from './harvest-client'
import { getHarvestCandidates } from '@/lib/actions/harvest'

export default async function HarvestPage() {
  const candidates = await getHarvestCandidates()
  return <HarvestClient initialCandidates={candidates} />
}
