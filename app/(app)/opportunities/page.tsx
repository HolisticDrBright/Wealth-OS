import { getOpportunities } from '@/lib/actions/opportunities'
import { OpportunitiesClient } from './opportunities-client'

export default async function OpportunitiesPage() {
  const opportunities = await getOpportunities()

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Opportunities</h1>
        <p className="text-sm text-gray-500 mt-1">AI-screened trade opportunities ranked by score</p>
      </div>
      <OpportunitiesClient initialOpportunities={opportunities} />
    </div>
  )
}
