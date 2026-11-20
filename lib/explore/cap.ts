/**
 * Core/Explore sleeves + the Explore cap (Phase 4.1–4.2).
 *
 * The portfolio is modeled as two sleeves on the EXISTING portfolio_sleeves
 * table (metadata.kind = 'core' | 'explore'):
 *  - Core: a diversified low-cost allocation from lib/allocation/policy.ts,
 *  - Explore: ALL strategy and copy-trading activity.
 *
 * The Explore cap is the Explore sleeve's target_allocation_pct. Default 10%
 * of money NOT in Tier 1 Safety (the three-tier ladder, lib/allocation/
 * ladder.ts), and $0 until Tier 1 is fully funded; pro users may raise it,
 * but never beyond EXPLORE_CAP_HARD_MAX_FRACTION. Enforcement happens in the
 * pre-trade path: a strategy or copy trade that would push Explore usage over
 * the cap — or any Explore trade while Tier 1 is short — is blocked and
 * logged like every other block.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_EXPLORE_CAP_FRACTION, EXPLORE_CAP_HARD_MAX_FRACTION } from '@/lib/config/product-defaults'
import { corePercentages, coreFundTargets, clampExploreCapFraction } from '@/lib/allocation/policy'
import { loadLadder } from '@/lib/allocation/ladder-data'

// Thresholds live in lib/config/product-defaults.ts; re-exported for callers.
export { DEFAULT_EXPLORE_CAP_FRACTION, EXPLORE_CAP_HARD_MAX_FRACTION }

// Pure clamp lives in the policy module (the ladder uses it too).
export { clampExploreCapFraction }

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
  /** Investable money (recorded assets minus non-investable categories). */
  totalValueUsd: number
  /** Money the cap is measured against: investable minus Tier 1 Safety. */
  baseUsd: number
  capUsd: number
  usedUsd: number
  leftUsd: number
  /** Explore is $0 until Tier 1 Safety is fully funded. */
  tier1Funded: boolean
  /** Plain-English reason when Explore is closed (Simple mode shows it). */
  closedReason: string | null
}

/**
 * Current Explore usage from the three-tier ladder: open strategy + copied
 * notional, against the cap fraction of money NOT in Tier 1 — and zero until
 * Tier 1 is fully funded.
 */
export async function getExploreUsage(
  supabase: SupabaseClient,
  userId: string
): Promise<ExploreUsage> {
  const ladder = await loadLadder(supabase, userId)
  return {
    capFraction: ladder.explore.capFraction,
    totalValueUsd: ladder.investableUsd,
    baseUsd: ladder.explore.baseUsd,
    capUsd: ladder.explore.capUsd,
    usedUsd: ladder.explore.inUseUsd,
    leftUsd: ladder.explore.leftUsd,
    tier1Funded: ladder.tier1.funded,
    closedReason: ladder.explore.reason,
  }
}

/** PURE cap check — exported for tests and reused by the async wrapper. */
export function exploreCapVerdict(usage: ExploreUsage, orderNotionalUsd: number): { allowed: boolean; reason?: string } {
  if (!(orderNotionalUsd > 0)) return { allowed: true }
  if (usage.totalValueUsd <= 0) {
    return { allowed: false, reason: 'explore_cap: no recorded portfolio value — cap is $0' }
  }
  // Safest money first: no Explore trade until Tier 1 Safety is full.
  if (!usage.tier1Funded) {
    return {
      allowed: false,
      reason: `tier1_unfunded: ${usage.closedReason ?? 'safety cushion not yet full — Explore is $0'}`,
    }
  }
  if (usage.usedUsd + orderNotionalUsd > usage.capUsd) {
    return {
      allowed: false,
      reason: `explore_cap: $${Math.round(usage.usedUsd + orderNotionalUsd).toLocaleString()} would exceed the ` +
        `${Math.round(usage.capFraction * 100)}% Explore limit ($${Math.round(usage.capUsd).toLocaleString()} ` +
        `of $${Math.round(usage.baseUsd).toLocaleString()} outside Safety); $${Math.round(usage.leftUsd).toLocaleString()} left`,
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
    metadata: {
      blocked_by: args.reason.startsWith('tier1_unfunded') ? 'tier1_gate' : 'explore_cap',
      reason: args.reason, route: args.route,
    },
  }).then(() => {}, () => {})
}
