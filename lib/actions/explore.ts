'use server'

/**
 * Explore view + cap management (Phase 4). Assembles everything the Explore
 * surface needs: the cap meter, per-trader copier-adjusted results, and
 * practice-run progress. Also the pro-only cap adjustment (clamped to the
 * named hard max).
 */

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getUiMode } from '@/lib/actions/ui-prefs'
import {
  ensureCoreExploreSleeves, getExploreUsage, clampExploreCapFraction,
  EXPLORE_CAP_HARD_MAX_FRACTION, type ExploreUsage,
} from '@/lib/explore/cap'
import {
  copierResultFor, swingLabelOf, riskAdjustedSortKey, practiceRunProgress,
  type CopierResult, type SwingLabel, type PracticeRun,
} from '@/lib/explore/copier-results'
import { getTraders } from '@/lib/actions/traders'
import type { Trader } from '@/lib/types'

export interface ExploreTrader {
  trader: Trader
  copier: CopierResult
  swing: SwingLabel
  practiceRun: PracticeRun | null
  autoCopyUnlocked: boolean
}

export interface ExploreView {
  uiMode: 'simple' | 'pro'
  usage: ExploreUsage
  hardMaxFraction: number
  traders: ExploreTrader[]
}

export async function getExploreView(): Promise<ExploreView | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Bootstrap the two sleeves on first visit (idempotent).
  await ensureCoreExploreSleeves(supabase, user.id).catch(() => null)

  const [uiMode, usage, traders, copiesRes] = await Promise.all([
    getUiMode(),
    getExploreUsage(supabase, user.id),
    getTraders(),
    supabase.from('user_copied_positions')
      .select('trader_id, pnl_pct')
      .eq('user_id', user.id)
      .not('pnl_pct', 'is', null),
  ])

  const copiesByTrader = new Map<string, number[]>()
  for (const r of (copiesRes.data ?? []) as Array<{ trader_id: string; pnl_pct: number }>) {
    if (!copiesByTrader.has(r.trader_id)) copiesByTrader.set(r.trader_id, [])
    copiesByTrader.get(r.trader_id)!.push(r.pnl_pct)
  }

  const enriched: ExploreTrader[] = traders.map(t => {
    const follow = t.follow_settings as { created_at?: string | null } | null
    const run = practiceRunProgress(follow?.created_at ?? null)
    return {
      trader: t,
      copier: copierResultFor({
        headlineReturnPct: t.total_return_pct,
        assetClass: t.asset_class,
        tradeCount: (t as unknown as { trade_count?: number | null }).trade_count ?? null,
        actualCopyPnlPcts: copiesByTrader.get(t.id) ?? [],
      }),
      swing: swingLabelOf(t.asset_class),
      practiceRun: run,
      autoCopyUnlocked: !!run?.complete,
    }
  })

  // 4.4: NEVER rank by raw return in simple mode — sort by the risk- and
  // delay-adjusted result instead. Pro keeps the existing raw ordering.
  if (uiMode === 'simple') {
    enriched.sort((a, b) =>
      riskAdjustedSortKey(b.copier.copierPct, b.trader.asset_class) -
      riskAdjustedSortKey(a.copier.copierPct, a.trader.asset_class))
  }

  return { uiMode, usage, hardMaxFraction: EXPLORE_CAP_HARD_MAX_FRACTION, traders: enriched }
}

/** Pro-mode only: adjust the Explore cap, clamped to the named hard max. */
export async function updateExploreCap(fraction: number): Promise<{ ok: boolean; error?: string; capFraction?: number }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not authenticated' }

  if ((await getUiMode()) !== 'pro') {
    return { ok: false, error: 'the Explore limit can only be changed in pro mode' }
  }

  const clamped = clampExploreCapFraction(fraction)
  const sleeves = await ensureCoreExploreSleeves(supabase, user.id)
  if (!sleeves) return { ok: false, error: 'could not load sleeves' }

  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabase.from('portfolio_sleeves')
      .update({ target_allocation_pct: Math.round(clamped * 1000) / 10, updated_at: new Date().toISOString() })
      .eq('id', sleeves.exploreId).eq('user_id', user.id),
    supabase.from('portfolio_sleeves')
      .update({ target_allocation_pct: Math.round((1 - clamped) * 1000) / 10, updated_at: new Date().toISOString() })
      .eq('id', sleeves.coreId).eq('user_id', user.id),
  ])
  if (e1 || e2) return { ok: false, error: (e1 ?? e2)!.message }

  revalidatePath('/traders')
  revalidatePath('/sleeves')
  return { ok: true, capFraction: clamped }
}
