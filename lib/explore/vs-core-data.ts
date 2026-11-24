/**
 * Explore vs Core data layer (roadmap #3) — client-agnostic (cookie client on
 * the web, bearer client on the phone, RLS as the user).
 *
 * Writes: approving a SHRINK (records the approval first, then lowers the
 * Explore sleeve's limit) and snoozing. Nothing here trades or sells.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { LADDER_KEYS_FILTER } from '@/lib/allocation/sleeves'
import { loadLadder } from '@/lib/allocation/ladder-data'
import { coreFundsForStockShare, coreStockShare } from '@/lib/allocation/policy'
import { ensureCoreExploreSleeves } from '@/lib/explore/cap'
import {
  exploreVsCore, shrinkVerdict, shrinkSummary,
  type DailyPoint, type DailySeries, type ExploreVsCore, type FundWeight, type ShrinkVerdict, type ExploreTrade,
} from '@/lib/explore/vs-core'
import { EXPLORE_REVIEW_LOOKBACK_DAYS, EXPLORE_SHRINK_SNOOZE_DAYS } from '@/lib/config/product-defaults'

const DAY = 86_400_000
const _series = new Map<string, { points: DailyPoint[]; at: number }>()

/** Dated daily closes (Yahoo), oldest first. Cached 12h; [] on failure. */
export async function fetchDailySeries(symbol: string, days: number): Promise<DailyPoint[]> {
  const key = `${symbol}:${days}`
  const hit = _series.get(key)
  if (hit && Date.now() - hit.at < 12 * 3_600_000) return hit.points
  try {
    const period2 = Math.floor(Date.now() / 1000)
    const period1 = period2 - days * 86_400
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${period2}`,
      { signal: AbortSignal.timeout(8_000) },
    )
    if (!res.ok) return []
    const data = await res.json() as { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } }
    const r = data.chart?.result?.[0]
    const ts = r?.timestamp ?? []
    const closes = r?.indicators?.quote?.[0]?.close ?? []
    const points: DailyPoint[] = []
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i]
      if (typeof c === 'number' && c > 0) points.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: c })
    }
    if (points.length) _series.set(key, { points, at: Date.now() })
    return points
  } catch {
    return []
  }
}

export interface ExploreVsCoreView {
  /** False when Core fund prices couldn't be fetched (no comparison possible right now). */
  available: boolean
  comparison: ExploreVsCore
  verdict: ShrinkVerdict
  /** The exact text approved when a shrink is proposed. */
  summary: string | null
  weights: FundWeight[]
}

export async function loadExploreVsCore(supabase: SupabaseClient, userId: string, now: Date = new Date()): Promise<ExploreVsCoreView> {
  const since = new Date(now.getTime() - EXPLORE_REVIEW_LOOKBACK_DAYS * DAY).toISOString()
  const [tradesRes, ladder, stateRes] = await Promise.all([
    supabase.from('paper_positions')
      .select('strategy_key, asset_class, notional_usd, realized_pnl_usd, opened_at, closed_at')
      .not('strategy_key', 'in', LADDER_KEYS_FILTER)
      .eq('user_id', userId).eq('status', 'closed').gte('closed_at', since).limit(10_000),
    loadLadder(supabase, userId, now).catch(() => null),
    supabase.from('explore_review_state').select('snoozed_until').eq('user_id', userId).maybeSingle(),
  ])

  // Core = the person's own glide-path mix (falls back to the default profile).
  const funds = ladder?.core.funds ?? coreFundsForStockShare(coreStockShare([], null, now))
  const weights: FundWeight[] = funds.filter(f => f.weight > 0).map(f => ({ symbol: f.symbol, weight: f.weight }))

  const series: DailySeries = {}
  await Promise.all(weights.map(async w => { series[w.symbol] = await fetchDailySeries(w.symbol, EXPLORE_REVIEW_LOOKBACK_DAYS + 10) }))
  const available = weights.length > 0 && weights.every(w => (series[w.symbol]?.length ?? 0) > 0)

  const comparison = exploreVsCore((tradesRes.data ?? []) as ExploreTrade[], series, weights, now)
  const verdict = available
    ? shrinkVerdict(comparison, {
        currentCapFraction: ladder?.explore.capFraction ?? 0,
        snoozedUntil: (stateRes.data as { snoozed_until?: string | null } | null)?.snoozed_until ?? null,
        now,
      })
    : { propose: false, reason: 'Core fund prices are unavailable right now — no comparison was made.', currentCapFraction: ladder?.explore.capFraction ?? 0, newCapFraction: null }
  return { available, comparison, verdict, summary: verdict.propose ? shrinkSummary(verdict) : null, weights }
}

export interface ShrinkResult { ok: boolean; error?: string; capFraction?: number }

/**
 * Approve the shrink. Re-checks the verdict server-side, records the approval
 * FIRST, then lowers the Explore sleeve (and raises Core's share to match).
 * Refuses anything that wouldn't LOWER the limit.
 */
export async function approveExploreShrink(supabase: SupabaseClient, userId: string, approvedSummary: string): Promise<ShrinkResult> {
  if (!approvedSummary.trim()) return { ok: false, error: 'approval_required: approved summary missing' }
  const view = await loadExploreVsCore(supabase, userId)
  const v = view.verdict
  if (!v.propose || v.newCapFraction == null || !(v.newCapFraction < v.currentCapFraction)) {
    return { ok: false, error: 'There is no Explore shrink to approve right now.' }
  }
  const { error: apprErr } = await supabase.from('automation_approvals').insert({
    user_id: userId, kind: 'explore_shrink', subject: 'explore', summary: approvedSummary,
    metadata: { from: v.currentCapFraction, to: v.newCapFraction, total: view.comparison.total },
  })
  if (apprErr) return { ok: false, error: `could not record approval: ${apprErr.message}` }

  const sleeves = await ensureCoreExploreSleeves(supabase, userId)
  if (!sleeves) return { ok: false, error: 'could not load sleeves' }
  const nowIso = new Date().toISOString()
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabase.from('portfolio_sleeves')
      .update({ target_allocation_pct: Math.round(v.newCapFraction * 1000) / 10, updated_at: nowIso })
      .eq('id', sleeves.exploreId).eq('user_id', userId),
    supabase.from('portfolio_sleeves')
      .update({ target_allocation_pct: Math.round((1 - v.newCapFraction) * 1000) / 10, updated_at: nowIso })
      .eq('id', sleeves.coreId).eq('user_id', userId),
  ])
  if (e1 || e2) return { ok: false, error: (e1 ?? e2)!.message }
  return { ok: true, capFraction: v.newCapFraction }
}

/** "Not now" — hide the proposal for EXPLORE_SHRINK_SNOOZE_DAYS. */
export async function snoozeExploreShrink(supabase: SupabaseClient, userId: string): Promise<{ ok: boolean; error?: string }> {
  const until = new Date(Date.now() + EXPLORE_SHRINK_SNOOZE_DAYS * DAY).toISOString()
  const { error } = await supabase.from('explore_review_state')
    .upsert({ user_id: userId, snoozed_until: until, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  return error ? { ok: false, error: error.message } : { ok: true }
}
