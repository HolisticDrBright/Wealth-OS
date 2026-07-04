/**
 * Strategy weight management.
 * Stores learned weights in Supabase (one row per user).
 * In-process memory cache reduces DB reads — only reloads when TTL expires.
 */
import { createAdminClient } from '@/lib/supabase/admin'

// ─── Defaults & constraints ───────────────────────────────────────────────────

/** Default weights when no learned data exists yet. Sum must equal 1.0 */
export const DEFAULT_WEIGHTS: Record<string, number> = {
  kronos:    0.30,
  mirofish:  0.20,
  combined:  0.25,
  momentum:  0.15,
  sentiment: 0.10,
}

/**
 * Per-strategy minimum weight floors.
 * Protects strategies with asymmetric P&L that naive scoring undervalues.
 */
export const STRATEGY_FLOORS: Record<string, number> = {
  combined: 0.12,  // always keep some blended signal
}

/** Global bounds for any single strategy's weight */
export const MIN_WEIGHT = 0.02
export const MAX_WEIGHT = 0.50

/**
 * Max weight change per learning pass — asymmetric by design.
 * Upgrades are slow (one good week proves little), downgrades are fast
 * (a deteriorating strategy compounds losses while we wait for confirmation).
 */
export const MAX_INCREASE_PER_CYCLE = 0.08
export const MAX_DECREASE_PER_CYCLE = 0.25
/** @deprecated kept for callers that referenced the old symmetric cap */
export const MAX_CHANGE_PER_CYCLE = MAX_INCREASE_PER_CYCLE

/** Minimum resolved outcomes before adjusting a strategy's weight */
export const MIN_SAMPLES = 3

/** Softmax temperature: lower = more concentrated on top performers */
export const SOFTMAX_TEMPERATURE = 0.5

// ─── In-process cache ────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000  // 1 minute

interface CacheEntry {
  weights: Record<string, number>
  ts: number
}
const _cache = new Map<string, CacheEntry>()

// ─── Core functions ───────────────────────────────────────────────────────────

/** Load weights for a user — returns cached copy if TTL not expired */
export async function loadWeightsForUser(userId: string): Promise<Record<string, number>> {
  const cached = _cache.get(userId)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { ...cached.weights }
  }

  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('strategy_weights')
      .select('weights')
      .eq('user_id', userId)
      .single()

    const learned = (data?.weights ?? {}) as Record<string, number>
    const merged = clampWeights({ ...DEFAULT_WEIGHTS, ...learned })
    _cache.set(userId, { weights: merged, ts: Date.now() })
    return { ...merged }
  } catch {
    return { ...DEFAULT_WEIGHTS }
  }
}

/** Persist weights to Supabase and update cache */
export async function saveWeightsForUser(
  userId: string,
  weights: Record<string, number>
): Promise<void> {
  const admin = createAdminClient()
  await admin.from('strategy_weights').upsert(
    { user_id: userId, weights, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  )
  _cache.set(userId, { weights: { ...weights }, ts: Date.now() })
}

/** Invalidate cache for a user (force reload on next access) */
export function invalidateCache(userId: string): void {
  _cache.delete(userId)
}

// ─── Regime-conditional read path (W3) ────────────────────────────────────────

/**
 * The capital-facing weight read: global learned weights re-shaped by the
 * CURRENT regime via regimeConditionalWeights(). Outcomes are regime-tagged
 * by joining closed paper positions to the regime_state history for their
 * close date. Fail-open to global weights when regime data is unavailable.
 */
export async function loadRegimeAdjustedWeights(userId: string): Promise<{
  weights: Record<string, number>
  globalWeights: Record<string, number>
  regime: string | null
}> {
  const globalWeights = await loadWeightsForUser(userId)
  try {
    const { regimeConditionalWeights } = await import('@/lib/regime/allocator')
    const admin = createAdminClient()

    const { data: history } = await admin
      .from('regime_state')
      .select('as_of, regime')
      .order('as_of', { ascending: false })
      .limit(365)
    const rows = (history ?? []) as Array<{ as_of: string; regime: string }>
    if (rows.length === 0) return { weights: globalWeights, globalWeights, regime: null }

    const currentRegime = rows[0].regime as import('@/lib/regime/allocator').AllocatorRegime
    const regimeByDay = new Map(rows.map(r => [r.as_of, r.regime]))

    const { data: closed } = await admin
      .from('paper_positions')
      .select('strategy_key, closed_at, realized_pnl_pct')
      .eq('user_id', userId)
      .eq('status', 'closed')
      .order('closed_at', { ascending: false })
      .limit(2000)

    const outcomes = ((closed ?? []) as Array<{ strategy_key: string; closed_at: string | null; realized_pnl_pct: number | null }>)
      .filter(p => p.closed_at != null && p.realized_pnl_pct != null)
      .map(p => ({
        strategyKey: p.strategy_key,
        regime: regimeByDay.get((p.closed_at as string).slice(0, 10)) as import('@/lib/regime/allocator').AllocatorRegime,
        returnPct: p.realized_pnl_pct as number,
      }))
      .filter(o => o.regime != null)

    const weights = regimeConditionalWeights(globalWeights, outcomes, currentRegime)
    return { weights, globalWeights, regime: currentRegime }
  } catch {
    return { weights: globalWeights, globalWeights, regime: null }
  }
}

// ─── Math ─────────────────────────────────────────────────────────────────────

/** Convert raw scores to a normalized weight distribution */
export function softmax(
  scores: Record<string, number>,
  temperature = SOFTMAX_TEMPERATURE
): Record<string, number> {
  const keys = Object.keys(scores)
  if (!keys.length) return {}

  const maxScore = Math.max(...Object.values(scores))
  const exps: Record<string, number> = {}
  let total = 0
  for (const k of keys) {
    exps[k] = Math.exp((scores[k] - maxScore) / temperature)
    total += exps[k]
  }
  return Object.fromEntries(keys.map(k => [k, exps[k] / total]))
}

/**
 * Evolve current weights toward target with capped per-cycle change.
 * Increases are capped tighter than decreases: one good week shouldn't
 * earn much capital, but a deteriorating strategy must shed it quickly.
 * Result is renormalized to sum to 1.
 */
export function clampEvolution(
  current: Record<string, number>,
  target: Record<string, number>
): Record<string, number> {
  const result: Record<string, number> = {}
  const keys = new Set([...Object.keys(current), ...Object.keys(target)])

  for (const k of keys) {
    const cur = current[k] ?? MIN_WEIGHT
    const tgt = target[k] ?? cur
    const delta = Math.max(-MAX_DECREASE_PER_CYCLE, Math.min(MAX_INCREASE_PER_CYCLE, tgt - cur))
    const floor = STRATEGY_FLOORS[k] ?? MIN_WEIGHT
    result[k] = Math.max(floor, Math.min(MAX_WEIGHT, cur + delta))
  }

  // Renormalize so weights sum to 1.0
  const total = Object.values(result).reduce((s, v) => s + v, 0)
  if (total > 0) {
    for (const k of Object.keys(result)) result[k] /= total
  }
  return result
}

/** Clamp all weights to their allowed range */
function clampWeights(weights: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [k, v] of Object.entries(weights)) {
    const floor = STRATEGY_FLOORS[k] ?? MIN_WEIGHT
    result[k] = Math.max(floor, Math.min(MAX_WEIGHT, v))
  }
  return result
}
