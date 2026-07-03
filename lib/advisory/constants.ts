/**
 * Loaders for tax_constants and kb_parameters + the staleness check.
 *
 * Failure semantics: advisory rules must NEVER run against partial or stale
 * constants silently. Missing table or empty year → throw; callers surface
 * "advisory unavailable" rather than computing from nothing.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TaxConstants, KbParameters } from './types'

export const STALENESS_DAYS = 90

interface ConstantRow { key: string; value: number; verified_at: string }

export async function loadTaxConstants(
  supabase: SupabaseClient,
  year: number = new Date().getUTCFullYear()
): Promise<TaxConstants> {
  const { data, error } = await supabase
    .from('tax_constants')
    .select('key, value, verified_at')
    .eq('year', year)
  if (error) throw new Error(`tax_constants read failed: ${error.message}`)
  const rows = (data ?? []) as ConstantRow[]
  if (rows.length === 0) {
    throw new Error(`tax_constants has no rows for ${year} — run the advisory migration/seed`)
  }
  const out: TaxConstants = {}
  for (const r of rows) out[r.key] = Number(r.value)
  return out
}

export async function loadKbParameters(supabase: SupabaseClient): Promise<KbParameters> {
  const { data, error } = await supabase
    .from('kb_parameters')
    .select('key, value, verified_at')
  if (error) throw new Error(`kb_parameters read failed: ${error.message}`)
  const rows = (data ?? []) as ConstantRow[]
  if (rows.length === 0) {
    throw new Error('kb_parameters is empty — run the advisory migration/seed')
  }
  const out: KbParameters = {}
  for (const r of rows) out[r.key] = Number(r.value)
  return out
}

export interface StaleConstant {
  table: 'tax_constants' | 'kb_parameters'
  key: string
  verifiedAt: string
  daysStale: number
}

/**
 * Constants unverified for >90 days. Wired into the cron route so stale
 * limits surface as alerts instead of silently producing outdated advice.
 */
export async function listStaleConstants(
  supabase: SupabaseClient,
  year: number = new Date().getUTCFullYear()
): Promise<StaleConstant[]> {
  const cutoff = Date.now() - STALENESS_DAYS * 86_400_000
  const stale: StaleConstant[] = []

  const [tax, kb] = await Promise.all([
    supabase.from('tax_constants').select('key, verified_at').eq('year', year),
    supabase.from('kb_parameters').select('key, verified_at'),
  ])

  for (const [table, res] of [['tax_constants', tax], ['kb_parameters', kb]] as const) {
    for (const row of (res.data ?? []) as Array<{ key: string; verified_at: string }>) {
      const t = new Date(row.verified_at).getTime()
      if (t < cutoff) {
        stale.push({
          table,
          key: row.key,
          verifiedAt: row.verified_at,
          daysStale: Math.floor((Date.now() - t) / 86_400_000),
        })
      }
    }
  }
  return stale
}
