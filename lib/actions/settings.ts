'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIFeatureDefinition {
  feature_key: string
  display_name: string
  description: string
  category: 'ai_confluence' | 'premium_data'
  cost_per_use_usd: number
  cost_unit: string
  default_budget_usd: number
}

export interface AIFeatureFlag {
  feature_key: string
  enabled: boolean
  monthly_budget_usd: number
  alert_threshold_pct: number
}

export interface AIUsageSummary {
  feature_key: string
  spend_usd: number
  call_count: number
}

export async function getUserSettings() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('user_settings')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  // Return defaults if no row yet
  return data ?? {
    id: user.id,
    risk_profile: 'moderate',
    copy_trading_budget_usd: 1000,
    autopilot_enabled: false,
    notifications_enabled: true,
    display_name: user.email?.split('@')[0] ?? '',
  }
}

export async function updateUserSettings(settings: {
  risk_profile?: string
  copy_trading_budget_usd?: number
  autopilot_enabled?: boolean
  notifications_enabled?: boolean
  display_name?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('user_settings')
    .upsert({ id: user.id, ...settings, updated_at: new Date().toISOString() })

  if (error) return { error: error.message }
  revalidatePath('/settings')
  revalidatePath('/autopilot')
  return { success: true }
}

export async function getBrokerStatus() {
  // Server-side check of which broker env vars are configured
  return {
    alpaca: !!(process.env.ALPACA_API_KEY && process.env.ALPACA_SECRET_KEY),
    kraken: !!(process.env.KRAKEN_API_KEY && process.env.KRAKEN_API_SECRET),
    oanda: !!(process.env.OANDA_API_KEY && process.env.OANDA_ACCOUNT_ID),
    polymarket: !!process.env.POLYMARKET_PRIVATE_KEY,
    anthropic: !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your-anthropic-api-key-here'),
    unusualWhales: !!process.env.UNUSUAL_WHALES_API_KEY,
    quiverQuant: !!process.env.QUIVER_QUANT_API_KEY,
    nansen: !!process.env.NANSEN_API_KEY,
    mirofish: !!process.env.MIROFISH_BASE_URL,
    coinStats: !!process.env.COINSTATS_API_KEY,
  }
}

// ─── AI Feature Flags ─────────────────────────────────────────────────────────

export async function getAIFeatureData(): Promise<{
  definitions: AIFeatureDefinition[]
  flags: AIFeatureFlag[]
  usage: AIUsageSummary[]
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [defResult, flagResult, usageResult] = await Promise.all([
    supabase
      .from('ai_feature_definitions')
      .select('feature_key, display_name, description, category, cost_per_use_usd, cost_unit, default_budget_usd')
      .eq('is_available', true)
      .order('category')
      .order('feature_key'),

    user
      ? supabase
          .from('ai_feature_flags')
          .select('feature_key, enabled, monthly_budget_usd, alert_threshold_pct')
          .eq('user_id', user.id)
      : Promise.resolve({ data: [] as AIFeatureFlag[] }),

    user
      ? supabase
          .from('ai_usage_logs')
          .select('feature_key, cost_usd')
          .eq('user_id', user.id)
          .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString())
      : Promise.resolve({ data: [] }),
  ])

  const usageMap = new Map<string, AIUsageSummary>()
  for (const row of (usageResult.data ?? [])) {
    const existing = usageMap.get(row.feature_key)
    if (existing) {
      existing.spend_usd += row.cost_usd
      existing.call_count += 1
    } else {
      usageMap.set(row.feature_key, { feature_key: row.feature_key, spend_usd: row.cost_usd, call_count: 1 })
    }
  }

  return {
    definitions: (defResult.data ?? []) as AIFeatureDefinition[],
    flags: (flagResult.data ?? []) as AIFeatureFlag[],
    usage: Array.from(usageMap.values()),
  }
}

export async function updateAIFeatureFlag(
  featureKey: string,
  updates: { enabled?: boolean; monthly_budget_usd?: number; alert_threshold_pct?: number }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.from('ai_feature_flags').upsert(
    {
      user_id: user.id,
      feature_key: featureKey,
      enabled: updates.enabled ?? false,
      monthly_budget_usd: updates.monthly_budget_usd ?? 20,
      alert_threshold_pct: updates.alert_threshold_pct ?? 80,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,feature_key' }
  )

  if (error) return { error: error.message }
  revalidatePath('/settings')
  return { success: true }
}
