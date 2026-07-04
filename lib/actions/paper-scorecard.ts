'use server'

/**
 * Paper-trading evidence scorecards — the per-strategy evidence pack the
 * two-month validation phase produces. All math lives in
 * lib/paper-trading/scorecard-core.ts (pure, unit-tested); this loader only
 * gathers rows.
 *
 * Every paper-enabled strategy gets a card — zero-trade, blocked-only,
 * open-only, and missing-data strategies included.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getRollingBrier } from '@/lib/learning/rolling-brier'
import { STRATEGY_REGISTRY_CONFIG, type StrategyKey } from '@/lib/strategies/strategy-registry'
// NOTE: 'use server' modules may only export async functions — import the
// PaperScorecard type from '@/lib/paper-trading/scorecard-core' directly.
import {
  assembleScorecard,
  type PaperScorecard,
  type ClosedTrade,
  type SkippedDetailRow,
} from '@/lib/paper-trading/scorecard-core'

interface PositionRow {
  strategy_key: string
  asset_class: string
  status: string
  closed_at: string | null
  realized_pnl_pct: number | null
}

interface TradeRow {
  strategy_key: string
  side: string
  slippage_bps: number | null
  created_at: string
}

interface AuditRow {
  strategy_key: string | null
  metadata: { blocked_by?: string } | null
}

interface ShadowRow {
  strategy_key: string
  realized_pnl_pct: number | null
}

interface RunRow {
  run_at: string
  skipped_details: Array<{ strategyKey?: string; outcome?: string }> | null
}

interface EnabledRow {
  strategy_key: string
  paper_enabled: boolean | null
}

export async function getPaperScorecards(): Promise<PaperScorecard[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  return loadScorecardsForUser(supabase, user.id)
}

/** Shared loader — also used by the paper-validation dashboard action. */
export async function loadScorecardsForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<PaperScorecard[]> {
  const [positions, trades, audits, shadows, runs, enabled] = await Promise.all([
    supabase
      .from('paper_positions')
      .select('strategy_key, asset_class, status, closed_at, realized_pnl_pct')
      .eq('user_id', userId)
      .limit(5000)
      .then(r => (r.data ?? []) as PositionRow[], () => [] as PositionRow[]),
    supabase
      .from('paper_trades')
      .select('strategy_key, side, slippage_bps, created_at')
      .eq('user_id', userId)
      .limit(5000)
      .then(r => (r.data ?? []) as TradeRow[], () => [] as TradeRow[]),
    supabase
      .from('audit_logs')
      .select('strategy_key, metadata')
      .eq('user_id', userId)
      .eq('decision', 'block')
      .limit(5000)
      .then(r => (r.data ?? []) as AuditRow[], () => [] as AuditRow[]),
    supabase
      .from('shadow_positions')
      .select('strategy_key, realized_pnl_pct')
      .eq('user_id', userId)
      .eq('status', 'closed')
      .limit(5000)
      .then(r => (r.data ?? []) as ShadowRow[], () => [] as ShadowRow[]),
    supabase
      .from('paper_trade_runs')
      .select('run_at, skipped_details')
      .eq('user_id', userId)
      .order('run_at', { ascending: false })
      .limit(200)
      .then(r => (r.data ?? []) as RunRow[], () => [] as RunRow[]),
    supabase
      .from('user_enabled_strategies')
      .select('strategy_key, paper_enabled')
      .eq('user_id', userId)
      .then(r => (r.data ?? []) as EnabledRow[], () => [] as EnabledRow[]),
  ])

  // ── Per-strategy aggregation ────────────────────────────────────────────────
  const closedByStrategy = new Map<string, ClosedTrade[]>()
  const openCountByStrategy = new Map<string, number>()
  const assetClassByStrategy = new Map<string, string>()
  for (const p of positions) {
    assetClassByStrategy.set(p.strategy_key, p.asset_class)
    if (p.status === 'open') {
      openCountByStrategy.set(p.strategy_key, (openCountByStrategy.get(p.strategy_key) ?? 0) + 1)
    } else if (p.closed_at && p.realized_pnl_pct != null) {
      const list = closedByStrategy.get(p.strategy_key) ?? []
      list.push({ closedAt: p.closed_at, returnPct: p.realized_pnl_pct })
      closedByStrategy.set(p.strategy_key, list)
    }
  }

  const entrySlipsBy = new Map<string, number[]>()
  const exitSlipsBy = new Map<string, number[]>()
  const opensBy = new Map<string, number>()
  const closesBy = new Map<string, number>()
  const lastTradeBy = new Map<string, string>()
  for (const t of trades) {
    if (t.side === 'open') {
      opensBy.set(t.strategy_key, (opensBy.get(t.strategy_key) ?? 0) + 1)
      if (t.slippage_bps != null) {
        const list = entrySlipsBy.get(t.strategy_key) ?? []
        list.push(t.slippage_bps)
        entrySlipsBy.set(t.strategy_key, list)
      }
    } else {
      closesBy.set(t.strategy_key, (closesBy.get(t.strategy_key) ?? 0) + 1)
      if (t.slippage_bps != null) {
        const list = exitSlipsBy.get(t.strategy_key) ?? []
        list.push(t.slippage_bps)
        exitSlipsBy.set(t.strategy_key, list)
      }
    }
    const prev = lastTradeBy.get(t.strategy_key)
    if (!prev || t.created_at > prev) lastTradeBy.set(t.strategy_key, t.created_at)
  }

  const auditBy = new Map<string, { blocked: number; vetoes: number }>()
  for (const a of audits) {
    if (!a.strategy_key) continue
    const entry = auditBy.get(a.strategy_key) ?? { blocked: 0, vetoes: 0 }
    entry.blocked += 1
    const blockedBy = a.metadata?.blocked_by ?? ''
    if (blockedBy.includes('risk') || blockedBy.includes('empirical_sizing') || blockedBy.includes('kill')) {
      entry.vetoes += 1
    }
    auditBy.set(a.strategy_key, entry)
  }

  const shadowBy = new Map<string, number[]>()
  for (const s of shadows) {
    if (s.realized_pnl_pct == null) continue
    const list = shadowBy.get(s.strategy_key) ?? []
    list.push(s.realized_pnl_pct)
    shadowBy.set(s.strategy_key, list)
  }

  const skippedBy = new Map<string, SkippedDetailRow[]>()
  const lastRunAt = runs[0]?.run_at ?? null
  for (const run of runs) {
    for (const d of run.skipped_details ?? []) {
      if (!d?.strategyKey) continue
      const list = skippedBy.get(d.strategyKey) ?? []
      list.push({ strategyKey: d.strategyKey, outcome: d.outcome ?? 'unknown' })
      skippedBy.set(d.strategyKey, list)
    }
  }

  // ── Universe: every paper-enabled strategy + everything with data ──────────
  const paperEnabledKeys = new Set(
    enabled.filter(e => e.paper_enabled === true).map(e => e.strategy_key)
  )
  const universe = new Set<string>([
    ...paperEnabledKeys,
    ...closedByStrategy.keys(),
    ...openCountByStrategy.keys(),
    ...opensBy.keys(),
    ...skippedBy.keys(),
  ])

  const out: PaperScorecard[] = []
  for (const strategyKey of universe) {
    const registryAsset = STRATEGY_REGISTRY_CONFIG[strategyKey as StrategyKey]?.assetClass
    const assetClass = assetClassByStrategy.get(strategyKey) ?? registryAsset ?? 'unknown'
    const brier = await getRollingBrier(supabase, strategyKey).catch(() => null)
    const shadowRets = shadowBy.get(strategyKey) ?? []
    const auditCounts = auditBy.get(strategyKey) ?? { blocked: 0, vetoes: 0 }

    out.push(assembleScorecard({
      strategyKey,
      assetClass,
      paperEnabled: paperEnabledKeys.has(strategyKey),
      closedTrades: closedByStrategy.get(strategyKey) ?? [],
      entrySlips: entrySlipsBy.get(strategyKey) ?? [],
      exitSlips: exitSlipsBy.get(strategyKey) ?? [],
      skippedDetails: skippedBy.get(strategyKey) ?? [],
      auditBlocked: auditCounts.blocked,
      auditVetoes: auditCounts.vetoes,
      fillsOpened: opensBy.get(strategyKey) ?? 0,
      exitsClosed: closesBy.get(strategyKey) ?? 0,
      openPositions: openCountByStrategy.get(strategyKey) ?? 0,
      lastRunAt,
      lastTradeAt: lastTradeBy.get(strategyKey) ?? null,
      rollingBrier: brier?.brierScore ?? null,
      shadowAvgReturnPct: shadowRets.length
        ? shadowRets.reduce((s, r) => s + r, 0) / shadowRets.length
        : null,
      closedShadowTrades: shadowRets.length,
    }))
  }

  return out.sort((a, b) => (b.expectancyPct ?? -Infinity) - (a.expectancyPct ?? -Infinity))
}
