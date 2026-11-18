/**
 * Explore view builder (Phase M4) — client-agnostic version of the web's
 * getExploreView: traders with copier-adjusted results, swing labels and
 * practice-run progress, plus the cap usage. Same helpers, same rules
 * (simple mode never ranks by raw return).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureCoreExploreSleeves, getExploreUsage, type ExploreUsage } from '@/lib/explore/cap'
import {
  copierResultFor, swingLabelOf, riskAdjustedSortKey, practiceRunProgress,
  type CopierResult, type SwingLabel, type PracticeRun,
} from '@/lib/explore/copier-results'

export interface ExploreTraderData {
  id: string
  name: string
  handle: string
  assetClass: string
  bio: string | null
  verified: boolean
  following: boolean
  autoCopyEnabled: boolean
  copier: CopierResult
  swing: SwingLabel
  practiceRun: PracticeRun | null
  autoCopyUnlocked: boolean
}

export interface ExploreData {
  usage: ExploreUsage
  traders: ExploreTraderData[]
}

export async function buildExploreData(
  supabase: SupabaseClient,
  userId: string,
  uiMode: 'simple' | 'pro'
): Promise<ExploreData> {
  await ensureCoreExploreSleeves(supabase, userId).catch(() => null)

  const [usage, tradersRes, followsRes, copiesRes] = await Promise.all([
    getExploreUsage(supabase, userId),
    supabase.from('traders')
      .select('id, name, handle, asset_class, bio, verified, total_return_pct, trade_count')
      .eq('is_active', true),
    supabase.from('user_followed_traders')
      .select('trader_id, auto_copy_enabled, created_at')
      .eq('user_id', userId),
    supabase.from('user_copied_positions')
      .select('trader_id, pnl_pct')
      .eq('user_id', userId)
      .not('pnl_pct', 'is', null),
  ])

  const follows = new Map(
    ((followsRes.data ?? []) as Array<{ trader_id: string; auto_copy_enabled: boolean | null; created_at: string | null }>)
      .map(f => [f.trader_id, f]))
  const copiesByTrader = new Map<string, number[]>()
  for (const r of (copiesRes.data ?? []) as Array<{ trader_id: string; pnl_pct: number }>) {
    if (!copiesByTrader.has(r.trader_id)) copiesByTrader.set(r.trader_id, [])
    copiesByTrader.get(r.trader_id)!.push(r.pnl_pct)
  }

  const traders: ExploreTraderData[] = ((tradersRes.data ?? []) as Array<{
    id: string; name: string; handle: string; asset_class: string; bio: string | null
    verified: boolean | null; total_return_pct: number | null; trade_count: number | null
  }>).map(t => {
    const follow = follows.get(t.id)
    const run = practiceRunProgress(follow?.created_at ?? null)
    return {
      id: t.id,
      name: t.name,
      handle: t.handle,
      assetClass: t.asset_class,
      bio: t.bio,
      verified: !!t.verified,
      following: !!follow,
      autoCopyEnabled: !!follow?.auto_copy_enabled,
      copier: copierResultFor({
        headlineReturnPct: t.total_return_pct ?? 0,
        assetClass: t.asset_class,
        tradeCount: t.trade_count,
        actualCopyPnlPcts: copiesByTrader.get(t.id) ?? [],
      }),
      swing: swingLabelOf(t.asset_class),
      practiceRun: run,
      autoCopyUnlocked: !!run?.complete,
    }
  })

  // Never rank by raw return in simple mode.
  if (uiMode === 'simple') {
    traders.sort((a, b) =>
      riskAdjustedSortKey(b.copier.copierPct, b.assetClass) -
      riskAdjustedSortKey(a.copier.copierPct, a.assetClass))
  }

  return { usage, traders }
}
