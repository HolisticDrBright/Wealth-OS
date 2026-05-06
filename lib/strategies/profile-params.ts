/**
 * Risk Profile utilities — load profile params and resolve effective strategies
 * for a given user.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { StrategyKey } from './strategy-registry'
import { STRATEGY_REGISTRY_CONFIG, type ProfileKey } from './strategy-registry'

export type { ProfileKey }

export interface ProfileParams {
  profileKey: ProfileKey
  displayName: string
  confluenceThreshold: number
  confluenceStrengthOverride: number | null
  positionCapPct: number
  maxConcurrentPositions: number
  hedgeSleevePctTarget: number
  stopLossMultiplier: number
  autoRetirementBrierThreshold: number
}

export interface UserRiskProfile {
  userId: string
  profileKey: ProfileKey
  uiMode: 'basic' | 'advanced'
  customStrategyOverrides: Record<string, boolean>
  customParamOverrides: Partial<ProfileParams>
  assetClassOverrides: Record<string, boolean>
  autoExecuteThresholdUsd: number | null
  onboardedAt: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = { from: (table: string) => any }

const FALLBACK_PARAMS: ProfileParams = {
  profileKey: 'balanced',
  displayName: 'Balanced',
  confluenceThreshold: 2,
  confluenceStrengthOverride: null,
  positionCapPct: 0.05,
  maxConcurrentPositions: 8,
  hedgeSleevePctTarget: 3,
  stopLossMultiplier: 1.0,
  autoRetirementBrierThreshold: 0.25,
}

export async function loadProfileParams(
  supabase: AnyDb,
  profileKey: ProfileKey
): Promise<ProfileParams> {
  const { data } = await supabase
    .from('risk_profiles')
    .select('*')
    .eq('profile_key', profileKey)
    .single() as { data: Record<string, unknown> | null }

  if (!data) return { ...FALLBACK_PARAMS, profileKey }

  return {
    profileKey: data.profile_key as ProfileKey,
    displayName: data.display_name as string,
    confluenceThreshold: Number(data.confluence_threshold),
    confluenceStrengthOverride: data.confluence_strength_override != null
      ? Number(data.confluence_strength_override) : null,
    positionCapPct: Number(data.position_cap_pct),
    maxConcurrentPositions: Number(data.max_concurrent_positions),
    hedgeSleevePctTarget: Number(data.hedge_sleeve_pct_target),
    stopLossMultiplier: Number(data.stop_loss_multiplier),
    autoRetirementBrierThreshold: Number(data.auto_retirement_brier_threshold),
  }
}

export async function loadUserProfile(
  supabase: AnyDb,
  userId: string
): Promise<UserRiskProfile> {
  const { data } = await supabase
    .from('user_risk_profile')
    .select('*')
    .eq('user_id', userId)
    .single() as { data: Record<string, unknown> | null }

  if (!data) {
    return {
      userId,
      profileKey: 'balanced',
      uiMode: 'basic',
      customStrategyOverrides: {},
      customParamOverrides: {},
      assetClassOverrides: {},
      autoExecuteThresholdUsd: null,
      onboardedAt: null,
    }
  }

  return {
    userId,
    profileKey: (data.profile_key as ProfileKey) ?? 'balanced',
    uiMode: (data.ui_mode as 'basic' | 'advanced') ?? 'basic',
    customStrategyOverrides: (data.custom_strategy_overrides as Record<string, boolean>) ?? {},
    customParamOverrides: (data.custom_param_overrides as Partial<ProfileParams>) ?? {},
    assetClassOverrides: (data.asset_class_overrides as Record<string, boolean>) ?? {},
    autoExecuteThresholdUsd: data.auto_execute_threshold_usd != null
      ? Number(data.auto_execute_threshold_usd) : null,
    onboardedAt: (data.onboarded_at as string) ?? null,
  }
}

/**
 * Returns the set of strategy keys the user is allowed to trade.
 *
 * Basic mode: profile enablement only.
 * Advanced mode: profile enablement + custom_strategy_overrides, minus excluded asset classes.
 */
export function getEffectiveStrategies(
  profile: UserRiskProfile
): Set<StrategyKey> {
  const enabled = new Set<StrategyKey>()

  for (const [key, cfg] of Object.entries(STRATEGY_REGISTRY_CONFIG) as [StrategyKey, typeof STRATEGY_REGISTRY_CONFIG[StrategyKey]][]) {
    const inProfile = cfg.enabledInProfiles.includes(profile.profileKey)

    if (profile.uiMode === 'basic') {
      // Honour asset class exclusions even in basic mode
      const excluded = profile.assetClassOverrides[cfg.assetClass] === false
      if (inProfile && !excluded) enabled.add(key)
    } else {
      // Advanced: start from profile baseline, apply strategy overrides, then asset class exclusions
      const override = profile.customStrategyOverrides[key]
      const byProfile = override !== undefined ? override : inProfile
      const excluded = profile.assetClassOverrides[cfg.assetClass] === false
      if (byProfile && !excluded) enabled.add(key)
    }
  }

  return enabled
}

/**
 * Merges profile baseline params with user custom_param_overrides (advanced mode only).
 */
export function getEffectiveParams(
  profileParams: ProfileParams,
  userProfile: UserRiskProfile
): ProfileParams {
  if (userProfile.uiMode === 'basic') return profileParams
  return { ...profileParams, ...userProfile.customParamOverrides }
}
