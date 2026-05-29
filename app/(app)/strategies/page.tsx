import { Topbar } from '@/components/layout/topbar'
import { StrategiesTabs } from './health-board-client'
import { getallProfiles, getUserRiskProfile } from '@/lib/actions/risk-profile'
import { getStrategyHealthRows } from '@/lib/actions/strategy-health'
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
  const [profileData, userProfile, strategyDefs, healthRows] = await Promise.all([
    getallProfiles(),
    getUserRiskProfile().catch(() => null),
    getStrategyDefinitions(),
    getStrategyHealthRows().catch(() => []),
  ])

  const defsWithEnv = strategyDefs.map(def => ({
    ...def,
    optionalEnv: STRATEGY_REGISTRY_CONFIG[def.strategy_key as keyof typeof STRATEGY_REGISTRY_CONFIG]?.optionalEnv ?? [],
    requiredEnv: STRATEGY_REGISTRY_CONFIG[def.strategy_key as keyof typeof STRATEGY_REGISTRY_CONFIG]?.requiredEnv ?? [],
  }))

  return (
    <div>
      <Topbar title="AI Strategies" subtitle="Strategy health, enablement, and configuration" />
      <StrategiesTabs
        rows={healthRows}
        configureProps={{
          profiles: profileData.profiles,
          userProfile,
          strategyDefs: defsWithEnv,
          currentProfileKey: (userProfile?.profileKey ?? 'balanced') as ProfileKey,
        }}
      />
    </div>
  )
}
