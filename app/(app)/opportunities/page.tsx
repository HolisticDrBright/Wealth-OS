import { getOpportunities } from '@/lib/actions/opportunities'
import { getNoTradeLedger } from '@/lib/actions/no-trade-ledger'
import { createClient } from '@/lib/supabase/server'
import { OpportunitiesClient } from './opportunities-client'

export default async function OpportunitiesPage() {
  const supabase = await createClient()
  const [{ data: { user } }, opportunities, noTradeEntries] = await Promise.all([
    supabase.auth.getUser(),
    getOpportunities(),
    getNoTradeLedger(),
  ])

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Opportunities</h1>
        <p className="text-sm text-gray-500 mt-1">
          AI-screened trade ideas — and a ledger of the signals we deliberately declined
        </p>
      </div>
      <OpportunitiesClient
        initialOpportunities={opportunities}
        noTradeEntries={noTradeEntries}
        userId={user?.id ?? ''}
      />
    </div>
  )
}
