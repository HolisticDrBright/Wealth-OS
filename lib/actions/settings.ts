'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

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
