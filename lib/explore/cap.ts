/**
 * Core/Explore sleeves + the Explore cap (Phase 4.1–4.2).
 *
 * The portfolio is modeled as two sleeves on the EXISTING portfolio_sleeves
 * table (metadata.kind = 'core' | 'explore'):
 *  - Core: a diversified low-cost allocation from lib/allocation/policy.ts,
 *  - Explore: ALL strategy and copy-trading activity.
 *
 * The Explore cap is the Explore sleeve's target_allocation_pct. Default 10%
 * of total portfolio value; pro users may raise it, but never beyond
 * EXPLORE_CAP_HARD_MAX_FRACTION. Enforcement happens in the pre-trade path:
 * a strategy or copy trade that would push Explore usage over the cap is
 * blocked and logged like every other block.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_EXPLORE_CAP_FRACTION, EXPLORE_CAP_HARD_MAX_FRACTION } from '@/lib/config/product-defaults'
import { corePercentages, coreFundTargets } from '@/lib/allocation/policy'

// Thresholds live in lib/config/product-defaults.ts; re-exported for callers.
export { DEFAULT_EXPLORE_CAP_FRACTION, EXPLORE_CAP_HARD_MAX_FRACTION }

export function clampExploreCapFraction(f: number | null | undefined): number {
  if (f == null || !Number.isFinite(f) || f < 0) return DEFAULT_EXPLORE_CAP_FRACTION
  return Math.min(EXPLORE_CAP_HARD_MAX_FRACTION, f)
}

export interface CoreExploreSleeves {
  coreId: string
  exploreId: string
  capFraction: number
}

/**
 * Find-or-create the two sleeves for a user. Idempotent; existing sleeves
 * (including a user-adjusted cap) are never overwritten.
 */
export async function ensureCoreExploreSleeves(
  supabase: SupabaseClient,
  userId: string
): Promise<CoreExploreSleeves | null> {
  const { data: rows } = await supabase
    .from('portfolio_sleeves')
    .select('id, target_allocation_pct, metadata')
    .eq('user_id', userId)

  const sleeves = (rows ?? []) as Array<{ id: string; target_allocation_pct: number | null; metadata: Record<string, unknown> | null }>
  let core = sleeves.find(s => s.metadata?.kind === 'core')
  let explore = sleeves.find(s => s.metadata?.kind === 'explore')

  if (!core) {
    const { data: profileRow } = await supabase
      .from('user_risk_profile').select('profile_key').eq('user_id', userId).maybeSingle()
    // Target mix comes from the single allocation policy (lib/allocation/policy.ts).
    const profileKey = profileRow?.profile_key as string | undefined
    const allocation = corePercentages(profileKey)
    const funds = coreFundTargets(profileKey).map(f => ({ symbol: f.symbol, weight: f.weight }))
    const { data } = await supabase
      .from('portfolio_sleeves')
      .insert({
        user_id: userId,
        name: 'Core',
        description: 'Broad, low-cost funds matched to your plan. Never touched by strategies or copying.',
        sleeve_type: 'manual',
        target_allocation_pct: Math.round((1 - DEFAULT_EXPLORE_CAP_FRACTION) * 100),
        benchmark_symbol: 'SPY',
        approval_required: true,
        metadata: { kind: 'core', allocation, funds },
      })
      .select('id, target_allocation_pct, metadata')
      .single()
    if (!data) return null
    core = data
  }

  if (!explore) {
    const { data } = await supabase
      .from('portfolio_sleeves')
      .insert({
        user_id: userId,
        name: 'Explore',
        description: 'A small, fenced-off part of your money for strategies and copying traders.',
        sleeve_type: 'autonomous',
        target_allocation_pct: Math.round(DEFAULT_EXPLORE_CAP_FRACTION * 100),
        approval_required: true,
        metadata: { kind: 'explore' },
      })
      .select('id, target_allocation_pct, metadata')
      .single()
    if (!data) return null
    explore = data
  }

  return {
    coreId: core.id,
    exploreId: explore.id,
    capFraction: clampExploreCapFraction(
      explore.target_allocation_pct != null ? Number(explore.target_allocation_pct) / 100 : null),
  }
}

export interface ExploreUsage {
  capFraction: number
  totalValueUsd: number
  capUsd: number
  usedUsd: number
  leftUsd: number
}

/**
 * Current Explore usage: open paper positions + open copied positions,
 * against the cap fraction of total portfolio value (recorded assets).
 */
export async function getExploreUsage(
  supabase: SupabaseClient,
  userId: string
): Promise<ExploreUsage> {
  const [sleevesRes, assetsRes, paperRes, copiedRes] = await Promise.all([
    supabase.from('portfolio_sleeves').select('target_allocation_pct, metadata').eq('user_id', userId),
    supabase.from('assets').select('current_value').eq('user_id', userId),
    supabase.from('paper_positions').select('notional_usd').eq('user_id', userId).eq('status', 'open'),
    supabase.from('user_copied_positions').select('notional_value').eq('user_id', userId).eq('status', 'open'),
  ])

  const explore = ((sleevesRes.data ?? []) as Array<{ target_allocation_pct: number | null; metadata: Record<string, unknown> | null }>)
    .find(s => s.metadata?.kind === 'explore')
  const capFraction = clampExploreCapFraction(
    explore?.target_allocation_pct != null ? Number(explore.target_allocation_pct) / 100 : null)

  const totalValueUsd = ((assetsRes.data ?? []) as Array<{ current_value: number | null }>)
    .reduce((s, r) => s + (r.current_value ?? 0), 0)
  const usedUsd =
    ((paperRes.data ?? []) as Array<{ notional_usd: number | null }>).reduce((s, r) => s + (r.notional_usd ?? 0), 0) +
    ((copiedRes.data ?? []) as Array<{ notional_value: number | null }>).reduce((s, r) => s + (r.notional_value ?? 0), 0)

  const capUsd = capFraction * totalValueUsd
  return {
    capFraction,
    totalValueUsd,
    capUsd: Math.round(capUsd * 100) / 100,
    usedUsd: Math.round(usedUsd * 100) / 100,
    leftUsd: Math.round(Math.max(0, capUsd - usedUsd) * 100) / 100,
  }
}

/** PURE cap check — exported for tests and reused by the async wrapper. */
export function exploreCapVerdict(usage: ExploreUsage, orderNotionalUsd: number): { allowed: boolean; reason?: string } {
  if (!(orderNotionalUsd > 0)) return { allowed: true }
  if (usage.totalValueUsd <= 0) {
    return { allowed: false, reason: 'explore_cap: no recorded portfolio value — cap is $0' }
  }
  if (usage.usedUsd + orderNotionalUsd > usage.capUsd) {
    return {
      allowed: false,
      reason: `explore_cap: $${Math.round(usage.usedUsd + orderNotionalUsd).toLocaleString()} would exceed the ` +
        `${Math.round(usage.capFraction * 100)}% Explore limit ($${Math.round(usage.capUsd).toLocaleString()} ` +
        `of $${Math.round(usage.totalValueUsd).toLocaleString()}); $${Math.round(usage.leftUsd).toLocaleString()} left`,
    }
  }
  return { allowed: true }
}

export async function exploreCapAllows(
  supabase: SupabaseClient,
  userId: string,
  orderNotionalUsd: number
): Promise<{ allowed: boolean; reason?: string; usage: ExploreUsage }> {
  const usage = await getExploreUsage(supabase, userId)
  return { ...exploreCapVerdict(usage, orderNotionalUsd), usage }
}

/** Log an Explore-cap block the same way other pre-trade blocks are logged. */
export async function logExploreCapBlock(
  supabase: SupabaseClient,
  userId: string,
  args: { strategyKey: string; symbol: string; reason: string; route: string }
): Promise<void> {
  await supabase.from('audit_logs').insert({
    user_id: userId, strategy_key: args.strategyKey, symbol: args.symbol,
    decision: 'block', size_fraction: 0, mirofish_used: false, kronos_used: false,
    decided_at: new Date().toISOString(),
    metadata: { blocked_by: 'explore_cap', reason: args.reason, route: args.route },
  }).then(() => {}, () => {})
}
