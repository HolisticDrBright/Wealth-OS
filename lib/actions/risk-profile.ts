'use server'

import { createClient } from '@/lib/supabase/server'
import type { ProfileKey } from '@/lib/strategies/profile-params'
import type { ProfileParams } from '@/lib/strategies/profile-params'

export interface UserRiskProfileRow {
  userId: string
  profileKey: ProfileKey
  uiMode: 'basic' | 'advanced'
  customStrategyOverrides: Record<string, boolean>
  customParamOverrides: Partial<ProfileParams>
  assetClassOverrides: Record<string, boolean>
  autoExecuteThresholdUsd: number | null
  onboardedAt: string | null
}

export interface AllProfilesData {
  profiles: Array<{
    profileKey: ProfileKey
    displayName: string
    description: string
    sort_order: number
  }>
  userProfile: UserRiskProfileRow | null
}

export async function getallProfiles(): Promise<AllProfilesData> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profiles } = await supabase
    .from('risk_profiles')
    .select('profile_key, display_name, description, sort_order')
    .order('sort_order')

  let userProfile: UserRiskProfileRow | null = null
  if (user) {
    const { data } = await supabase
      .from('user_risk_profile')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (data) {
      userProfile = {
        userId: user.id,
        profileKey: data.profile_key as ProfileKey,
        uiMode: data.ui_mode as 'basic' | 'advanced',
        customStrategyOverrides: (data.custom_strategy_overrides ?? {}) as Record<string, boolean>,
        customParamOverrides: (data.custom_param_overrides ?? {}) as Partial<ProfileParams>,
        assetClassOverrides: (data.asset_class_overrides ?? {}) as Record<string, boolean>,
        autoExecuteThresholdUsd: data.auto_execute_threshold_usd != null
          ? Number(data.auto_execute_threshold_usd) : null,
        onboardedAt: data.onboarded_at ?? null,
      }
    }
  }

  return {
    profiles: (profiles ?? []).map(p => ({
      profileKey: p.profile_key as ProfileKey,
      displayName: p.display_name,
      description: p.description,
      sort_order: p.sort_order,
    })),
    userProfile,
  }
}

export async function getUserRiskProfile(): Promise<UserRiskProfileRow | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('user_risk_profile')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (!data) return null

  return {
    userId: user.id,
    profileKey: data.profile_key as ProfileKey,
    uiMode: data.ui_mode as 'basic' | 'advanced',
    customStrategyOverrides: (data.custom_strategy_overrides ?? {}) as Record<string, boolean>,
    customParamOverrides: (data.custom_param_overrides ?? {}) as Partial<ProfileParams>,
    assetClassOverrides: (data.asset_class_overrides ?? {}) as Record<string, boolean>,
    autoExecuteThresholdUsd: data.auto_execute_threshold_usd != null
      ? Number(data.auto_execute_threshold_usd) : null,
    onboardedAt: data.onboarded_at ?? null,
  }
}

export async function upsertUserProfile(profileKey: ProfileKey): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('user_risk_profile')
    .upsert({
      user_id: user.id,
      profile_key: profileKey,
      last_changed_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  return error ? { error: error.message } : {}
}

export async function updateUiMode(mode: 'basic' | 'advanced'): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('user_risk_profile')
    .upsert({
      user_id: user.id,
      ui_mode: mode,
      last_changed_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  return error ? { error: error.message } : {}
}

export async function updateStrategyOverride(
  strategyKey: string,
  enabled: boolean
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: existing } = await supabase
    .from('user_risk_profile')
    .select('custom_strategy_overrides')
    .eq('user_id', user.id)
    .single()

  const overrides = ((existing?.custom_strategy_overrides ?? {}) as Record<string, boolean>)
  overrides[strategyKey] = enabled

  const { error } = await supabase
    .from('user_risk_profile')
    .upsert({
      user_id: user.id,
      custom_strategy_overrides: overrides,
      last_changed_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  return error ? { error: error.message } : {}
}

export async function updateAssetClassOverride(
  assetClass: string,
  enabled: boolean
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: existing } = await supabase
    .from('user_risk_profile')
    .select('asset_class_overrides')
    .eq('user_id', user.id)
    .single()

  const overrides = ((existing?.asset_class_overrides ?? {}) as Record<string, boolean>)
  overrides[assetClass] = enabled

  const { error } = await supabase
    .from('user_risk_profile')
    .upsert({
      user_id: user.id,
      asset_class_overrides: overrides,
      last_changed_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  return error ? { error: error.message } : {}
}

export async function updateAutoExecuteThreshold(
  thresholdUsd: number | null
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('user_risk_profile')
    .upsert({
      user_id: user.id,
      auto_execute_threshold_usd: thresholdUsd,
      last_changed_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  return error ? { error: error.message } : {}
}

export async function saveStateOfResidence(state: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('profiles')
    .update({ state_of_residence: state || null })
    .eq('id', user.id)

  return error ? { error: error.message } : {}
}

export async function saveOnboardedProfile(
  profileKey: ProfileKey,
  autoExecuteThresholdUsd?: number
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('user_risk_profile')
    .upsert({
      user_id: user.id,
      profile_key: profileKey,
      ui_mode: 'basic',
      custom_strategy_overrides: {},
      custom_param_overrides: {},
      asset_class_overrides: {},
      auto_execute_threshold_usd: autoExecuteThresholdUsd ?? null,
      onboarded_at: new Date().toISOString(),
      last_changed_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  return error ? { error: error.message } : {}
}
