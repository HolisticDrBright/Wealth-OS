'use server'

/**
 * Promotion readiness — the track record (Phase 6). READ-ONLY: lists EVERY
 * registered strategy with its maturity, closed paper trades against the
 * promotion minimum, net result after costs, drawdown, which promotion gates
 * pass, and whether its paper record has scan gaps. Nothing here changes a
 * maturity status — promotion stays a manual registry edit.
 */

import { createClient } from '@/lib/supabase/server'
import { STRATEGY_REGISTRY_CONFIG, type StrategyKey } from '@/lib/strategies/strategy-registry'
import { toDisplayName } from '@/lib/strategies/strategy-display'
import { bookFor } from '@/lib/strategies/strategy-books'
import {
  evaluatePaperToLive, MIN_CLOSED_TRADES, type PromotionCriterion, type ShadowComparison,
} from '@/lib/strategies/promotion-gates'
import { summarizeTrackRecord, type ClosedTradeRow, type TrackRecordSummary } from '@/lib/strategies/track-record'
import { getRollingBrier } from '@/lib/learning/rolling-brier'
import { LADDER_KEYS_FILTER } from '@/lib/allocation/sleeves'
import { getScanHealth, gapsSince, type ScanGap, type ScanHealth } from '@/lib/ops/scan-heartbeat'
import { loadExploreVsCore } from '@/lib/explore/vs-core-data'
import type { VsCoreLine } from '@/lib/explore/vs-core'

export interface TrackRecordRow extends TrackRecordSummary {
  strategyKey: string
  displayName: string
  book: string
  assetClass: string
  maturity: string
  minTrades: number
  /** Paper → live gates (only meaningful for paper_trading strategies). */
  criteria: PromotionCriterion[]
  gatesPassed: number
  gatesTotal: number
  /** Scan gaps since this strategy's first closed trade. */
  gaps: ScanGap[]
  /** Roadmap #3: after costs vs the same dollars in Core, last 12 months (null = no comparable trades). */
  vsCoreExcessUsd: number | null
  /** Roadmap #4: the latest automatic switch-off, if any. */
  retired: { at: string; reason: string; rule: string | null } | null
  /** Consecutive failing weekly gate reviews since the last switch-off. */
  failingWeeks: number
}

export interface TrackRecordView {
  rows: TrackRecordRow[]
  scan: ScanHealth
  /** All Explore trades vs the same dollars in Core (null when Core prices are unavailable). */
  vsCoreTotal: (VsCoreLine & { daysCovered: number }) | null
}

const BRIER_FETCH_MIN_TRADES = 10
const MAX_BRIER_FETCHES = 15

export async function getTrackRecord(): Promise<TrackRecordView | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: closed }, { data: shadowClosed }, scan, vsCore, retiredRes, snapsRes] = await Promise.all([
    supabase.from('paper_positions')
      .select('strategy_key, realized_pnl_pct, realized_pnl_usd, notional_usd, opened_at, closed_at')
      .not('strategy_key', 'in', LADDER_KEYS_FILTER)
      .eq('user_id', user.id).eq('status', 'closed').limit(10_000),
    supabase.from('shadow_positions')
      .select('strategy_key, realized_pnl_usd, would_have_notional')
      .eq('user_id', user.id).eq('status', 'closed').limit(10_000),
    getScanHealth(supabase),
    loadExploreVsCore(supabase, user.id).catch(() => null),
    supabase.from('strategy_retirement_log').select('strategy_key, created_at, reason, rule')
      .eq('user_id', user.id).order('created_at', { ascending: false }),
    supabase.from('strategy_gate_snapshots').select('strategy_key, week, failing')
      .eq('user_id', user.id).order('week', { ascending: false }),
  ])
  const lastRetired = new Map<string, { at: string; reason: string; rule: string | null }>()
  for (const r of (retiredRes.data ?? []) as Array<{ strategy_key: string; created_at: string; reason: string; rule: string | null }>) {
    if (!lastRetired.has(r.strategy_key)) lastRetired.set(r.strategy_key, { at: r.created_at, reason: r.reason, rule: r.rule })
  }
  const failingWeeksBy = new Map<string, number>()
  const streakDone = new Set<string>()
  for (const s of (snapsRes.data ?? []) as Array<{ strategy_key: string; week: string; failing: boolean | null }>) {
    if (streakDone.has(s.strategy_key)) continue
    const since = lastRetired.get(s.strategy_key)?.at.slice(0, 10)
    if (since && String(s.week).slice(0, 10) <= since) { streakDone.add(s.strategy_key); continue }
    if (s.failing === true) failingWeeksBy.set(s.strategy_key, (failingWeeksBy.get(s.strategy_key) ?? 0) + 1)
    else streakDone.add(s.strategy_key)
  }
  const vsCoreByKey = new Map((vsCore?.available ? vsCore.comparison.perStrategy : []).map(l => [l.strategyKey, l]))

  const byKey = new Map<string, ClosedTradeRow[]>()
  for (const r of (closed ?? []) as ClosedTradeRow[]) {
    if (!byKey.has(r.strategy_key)) byKey.set(r.strategy_key, [])
    byKey.get(r.strategy_key)!.push(r)
  }
  const shadowByKey = new Map<string, number[]>()
  for (const r of (shadowClosed ?? []) as Array<{ strategy_key: string; realized_pnl_usd: number | null; would_have_notional: number | null }>) {
    if (typeof r.realized_pnl_usd !== 'number' || !(r.would_have_notional ?? 0)) continue
    if (!shadowByKey.has(r.strategy_key)) shadowByKey.set(r.strategy_key, [])
    shadowByKey.get(r.strategy_key)!.push(r.realized_pnl_usd / (r.would_have_notional as number))
  }

  const keys = Object.keys(STRATEGY_REGISTRY_CONFIG) as StrategyKey[]
  const strategiesTested = Math.max(1, keys.filter(k => (byKey.get(k)?.length ?? 0) > 0).length)
  const brierKeys = keys
    .filter(k => (byKey.get(k)?.length ?? 0) >= BRIER_FETCH_MIN_TRADES)
    .sort((a, b) => (byKey.get(b)?.length ?? 0) - (byKey.get(a)?.length ?? 0))
    .slice(0, MAX_BRIER_FETCHES)
  const brier = new Map(await Promise.all(
    brierKeys.map(async k => [k, (await getRollingBrier(supabase, k).catch(() => null))?.brierScore ?? null] as const),
  ))

  const rows: TrackRecordRow[] = keys.map(key => {
    const cfg = STRATEGY_REGISTRY_CONFIG[key]
    const trades = byKey.get(key) ?? []
    const summary = summarizeTrackRecord(trades, cfg.assetClass)
    const shadowReturns = shadowByKey.get(key) ?? []
    const shadow: ShadowComparison = {
      shadowAvgReturnPct: shadowReturns.length ? shadowReturns.reduce((s, v) => s + v, 0) / shadowReturns.length : null,
      closedShadowTrades: shadowReturns.length,
    }
    const readiness = evaluatePaperToLive(key, {
      closedTrades: summary.closedTrades, avgReturnPct: summary.avgReturnPct,
      maxDrawdownPct: summary.maxDrawdownPct, assetClass: cfg.assetClass,
      // Roadmap #4: the luck correction counts every strategy that has a record.
      tradeReturnsPct: trades.map(t => t.realized_pnl_pct).filter((v): v is number => typeof v === 'number'),
      strategiesTested,
    }, brier.get(key) ?? null, shadow)
    return {
      ...summary,
      strategyKey: key,
      displayName: toDisplayName(key),
      book: bookFor(key),
      assetClass: cfg.assetClass,
      maturity: cfg.maturityStatus,
      minTrades: MIN_CLOSED_TRADES,
      criteria: readiness.criteria,
      gatesPassed: readiness.criteria.filter(c => c.evaluable && c.pass).length,
      gatesTotal: readiness.criteria.length,
      gaps: gapsSince(scan.gaps, summary.firstTradeAt),
      vsCoreExcessUsd: vsCoreByKey.get(key)?.trades ? vsCoreByKey.get(key)!.excessUsd : null,
      retired: lastRetired.get(key) ?? null,
      failingWeeks: failingWeeksBy.get(key) ?? 0,
    }
  })

  // Paper-trading strategies first, then by evidence.
  const order: Record<string, number> = { live: 0, live_candidate: 1, paper_trading: 2, backtest_ready: 3, stub: 4, retired: 5 }
  rows.sort((a, b) => (order[a.maturity] ?? 9) - (order[b.maturity] ?? 9) || b.closedTrades - a.closedTrades)
  return {
    rows, scan,
    vsCoreTotal: vsCore?.available ? { ...vsCore.comparison.total, daysCovered: vsCore.comparison.daysCovered } : null,
  }
}
