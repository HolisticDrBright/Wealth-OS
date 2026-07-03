/**
 * Polymarket priors from the corpus (R1) — empirical-Kelly's modelWinProb
 * for prediction-market entries comes from MEASURED per-category resolution
 * frequencies (category_bias aggregates), not folklore longshot-bias claims.
 * No corpus row (n < 100) → null: the caller must NOT assume an edge.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 0.1

export function priceBucketOf(price: number): number {
  const b = Math.floor(price / BUCKET) * BUCKET + BUCKET / 2
  return Math.round(Math.min(0.95, Math.max(0.05, b)) * 100) / 100
}

let _cache: { rows: Array<{ category: string; price_bucket: number; realized_freq: number; n: number }>; at: number } | null = null
const CACHE_MS = 60 * 60 * 1000

export async function loadCategoryPrior(
  supabase: SupabaseClient,
  category: string,
  price: number
): Promise<number | null> {
  try {
    if (!_cache || Date.now() - _cache.at > CACHE_MS) {
      const { data } = await supabase
        .from('category_bias')
        .select('category, price_bucket, realized_freq, n')
      _cache = { rows: (data ?? []) as never, at: Date.now() }
    }
    const bucket = priceBucketOf(price)
    const row = _cache.rows.find(
      r => r.category === category && Math.abs(Number(r.price_bucket) - bucket) < 1e-9
    )
    if (!row || row.n < 100) return null
    return Math.min(0.99, Math.max(0.01, Number(row.realized_freq)))
  } catch {
    return null
  }
}

/** Test hook. */
export function _setPriorCacheForTest(rows: Array<{ category: string; price_bucket: number; realized_freq: number; n: number }>): void {
  _cache = { rows, at: Date.now() }
}
