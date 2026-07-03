/**
 * Measured cost overrides (R3a) — TCA-measured one-way costs replace the
 * static model when a venue has enough real fills. The edge gate then prices
 * entries off reality, not estimates.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { oneWayCostBps } from './transaction-costs'

export type CostOverrides = Record<string, number>

let _cache: { overrides: CostOverrides; at: number } | null = null
const CACHE_MS = 15 * 60 * 1000

export async function loadCostOverrides(supabase: SupabaseClient): Promise<CostOverrides> {
  if (_cache && Date.now() - _cache.at < CACHE_MS) return _cache.overrides
  try {
    const { data } = await supabase.from('cost_overrides').select('asset_class, one_way_bps')
    const overrides: CostOverrides = {}
    for (const r of (data ?? []) as Array<{ asset_class: string; one_way_bps: number }>) {
      overrides[r.asset_class] = Number(r.one_way_bps)
    }
    _cache = { overrides, at: Date.now() }
    return overrides
  } catch {
    return {}
  }
}

/** Measured cost when available, static model otherwise. */
export function effectiveOneWayCostBps(assetClass: string, overrides: CostOverrides): number {
  return overrides[assetClass] ?? oneWayCostBps(assetClass)
}
