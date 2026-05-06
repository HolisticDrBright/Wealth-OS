import { Topbar } from '@/components/layout/topbar'
import { AIStrategiesClient } from './ai-strategies-client'
import { getallProfiles, getUserRiskProfile } from '@/lib/actions/risk-profile'
import { createClient } from '@/lib/supabase/server'
import { STRATEGY_REGISTRY_CONFIG } from '@/lib/strategies/strategy-registry'
import type { ProfileKey } from '@/lib/strategies/profile-params'

async function getStrategyDefinitions() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('strategy_definitions')
    .select('*')
    .order('asset_class')
  return data ?? []
}

export default async function StrategiesPage() {
  const [profileData, userProfile, strategyDefs] = await Promise.all([
    getallProfiles(),
    getUserRiskProfile().catch(() => null),
    getStrategyDefinitions(),
  ])

  const defsWithEnv = strategyDefs.map(def => ({
    ...def,
    optionalEnv: STRATEGY_REGISTRY_CONFIG[def.strategy_key as keyof typeof STRATEGY_REGISTRY_CONFIG]?.optionalEnv ?? [],
    requiredEnv: STRATEGY_REGISTRY_CONFIG[def.strategy_key as keyof typeof STRATEGY_REGISTRY_CONFIG]?.requiredEnv ?? [],
  }))

  return (
    <div>
      <Topbar title="AI Strategies" subtitle="Pick your risk profile — AI activates the right strategies" />
      <AIStrategiesClient
        profiles={profileData.profiles}
        userProfile={userProfile}
        strategyDefs={defsWithEnv}
        currentProfileKey={(userProfile?.profileKey ?? 'balanced') as ProfileKey}
      />
    </div>
  )
}
