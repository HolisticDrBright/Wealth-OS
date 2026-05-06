'use server'

import { createClient } from '@/lib/supabase/server'

export interface RiskProfileRow {
  profile_key: string
  display_name: string
  description: string
  confluence_threshold: number
  position_cap_pct: number
  max_concurrent_positions: number
  hedge_sleeve_pct_target: number
  stop_loss_multiplier: number
  alloc_stocks: number
  alloc_options: number
  alloc_crypto: number
  alloc_forex: number
  alloc_polymarket: number
  alloc_multi_asset: number
  sort_order: number
}

export interface StrategyDefRow {
  strategy_key: string
  layman_name: string
  plain_english_description: string
  enabled_in_profiles: string[]
  asset_class: string
  requires_advanced_warning: boolean
}

export interface UserRiskProfileRow {
  user_id: string
  profile_key: string
  ui_mode: 'basic' | 'advanced'
  custom_strategy_overrides: Record<string, boolean>
  custom_param_overrides: Record<string, unknown>
  asset_class_overrides: Record<string, boolean>
  auto_execute_threshold_usd: number | null
  onboarded_at: string | null
}

export interface AssetRiskProfileData {
  profiles: RiskProfileRow[]
  userProfile: UserRiskProfileRow | null
  strategyDefs: StrategyDefRow[]
  migrationApplied: boolean
}

export async function getAssetRiskProfileData(
  assetClass: string
): Promise<AssetRiskProfileData> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const profilesQuery = supabase
    .from('risk_profiles')
    .select('*')
    .order('sort_order')

  const defsQuery = assetClass === 'all'
    ? supabase.from('strategy_definitions').select('*').order('layman_name')
    : supabase.from('strategy_definitions').select('*').eq('asset_class', assetClass).order('layman_name')

  const userProfileQuery = user
    ? supabase.from('user_risk_profile').select('*').eq('user_id', user.id).single()
    : Promise.resolve({ data: null, error: null })

  const [profilesRes, defsRes, userProfileRes] = await Promise.all([
    profilesQuery,
    defsQuery,
    userProfileQuery,
  ])

  const profiles = (profilesRes.data ?? []) as RiskProfileRow[]
  const strategyDefs = (defsRes.data ?? []) as StrategyDefRow[]

  let userProfile: UserRiskProfileRow | null = null
  if (userProfileRes.data) {
    const d = userProfileRes.data as Record<string, unknown>
    userProfile = {
      user_id: d.user_id as string,
      profile_key: (d.profile_key as string) ?? 'balanced',
      ui_mode: (d.ui_mode as 'basic' | 'advanced') ?? 'basic',
      custom_strategy_overrides: (d.custom_strategy_overrides as Record<string, boolean>) ?? {},
      custom_param_overrides: (d.custom_param_overrides as Record<string, unknown>) ?? {},
      asset_class_overrides: (d.asset_class_overrides as Record<string, boolean>) ?? {},
      auto_execute_threshold_usd: d.auto_execute_threshold_usd != null
        ? Number(d.auto_execute_threshold_usd) : null,
      onboarded_at: (d.onboarded_at as string) ?? null,
    }
  }

  if (profilesRes.error) {
    console.error('[asset-risk-profile] profiles query error:', profilesRes.error.message)
  }

  return {
    profiles,
    userProfile,
    strategyDefs,
    migrationApplied: profiles.length > 0,
  }
}
