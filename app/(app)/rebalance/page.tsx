import { createClient } from '@/lib/supabase/server'
import { getPortfolioTargets, getRebalanceSuggestions } from '@/lib/actions/rebalance'
import { RebalanceClient } from './rebalance-client'
import { defaultRebalanceTargets } from '@/lib/allocation/policy'

export default async function RebalancePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [assets, targets, suggestions, profileRes] = await Promise.all([
    supabase.from('assets').select('*').eq('user_id', user.id).then(r => r.data ?? []),
    getPortfolioTargets(),
    getRebalanceSuggestions(),
    supabase.from('user_risk_profile').select('profile_key').eq('user_id', user.id).maybeSingle(),
  ])
  const defaultTargets = defaultRebalanceTargets((profileRes.data?.profile_key as string | undefined) ?? null)

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Rebalancing</h1>
        <p className="text-sm text-gray-500 mt-1">Maintain your target allocation automatically</p>
      </div>
      <RebalanceClient
        assets={assets}
        initialTargets={targets}
        defaultTargets={defaultTargets}
        initialSuggestions={suggestions}
      />
    </div>
  )
}
