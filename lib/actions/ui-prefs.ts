'use server'

/**
 * UI preferences — Advisor (card-based, plain-language) vs Terminal (dense,
 * mono) density. One data layer, two skins: the toggle switches a density
 * context, never routes. Persisted per user in Supabase.
 */

import { createClient } from '@/lib/supabase/server'

export type UiDensity = 'advisor' | 'terminal'

export async function getUiDensity(): Promise<UiDensity> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return 'advisor'
    const { data } = await supabase
      .from('user_ui_prefs')
      .select('density')
      .eq('user_id', user.id)
      .maybeSingle()
    return (data?.density as UiDensity | undefined) ?? 'advisor'
  } catch {
    return 'advisor'
  }
}

export async function setUiDensity(density: UiDensity): Promise<{ ok: boolean }> {
  if (density !== 'advisor' && density !== 'terminal') return { ok: false }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const { error } = await supabase
    .from('user_ui_prefs')
    .upsert({ user_id: user.id, density, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  return { ok: !error }
}

// ─── Simple / Pro mode (Phase 3.1) ───────────────────────────────────────────
// Unset = 'pro', so every EXISTING user keeps the full Command Center.
// New users get 'simple' written when the onboarding wizard completes.

export type UiMode = 'simple' | 'pro'

export async function getUiMode(): Promise<UiMode> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return 'pro'
    const { data } = await supabase
      .from('user_ui_prefs')
      .select('ui_mode')
      .eq('user_id', user.id)
      .maybeSingle()
    return (data?.ui_mode as UiMode | undefined) ?? 'pro'
  } catch {
    return 'pro'
  }
}

export async function setUiMode(mode: UiMode): Promise<{ ok: boolean }> {
  if (mode !== 'simple' && mode !== 'pro') return { ok: false }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const { error } = await supabase
    .from('user_ui_prefs')
    .upsert({ user_id: user.id, ui_mode: mode, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  return { ok: !error }
}
