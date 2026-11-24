'use server'

/**
 * Promotion pipeline — runs every paper-trading strategy through the
 * paper→live promotion gates using live evidence (closed paper trades,
 * rolling Brier, shadow comparison).
 *
 * Read-only: computing readiness never changes a strategy's maturity status.
 * Promotion remains a manual, explicit registry edit.
 *
 * Batched: one query for all closed paper positions, one for all closed
 * shadow positions; rolling Brier (per-strategy query) only for strategies
 * with enough closed trades to possibly be promotable.
 */

import { createClient } from '@/lib/supabase/server'
import { STRATEGY_REGISTRY_CONFIG, type StrategyKey } from '@/lib/strategies/strategy-registry'
import { toDisplayName } from '@/lib/strategies/strategy-display'
import {
  evaluatePaperToLive,
  type PromotionReadiness, type PaperTradeStats, type ShadowComparison,
} from '@/lib/strategies/promotion-gates'
import { getRollingBrier } from '@/lib/learning/rolling-brier'
import { LADDER_KEYS_FILTER } from '@/lib/allocation/sleeves'
import { computeDrawdown } from '@/lib/strategies/track-record'

export interface PromotionPipelineRow extends PromotionReadiness {
  displayName: string
  /** Count of criteria currently passing (for sorting "closest to ready"). */
  passing: number
  totalCriteria: number
}

interface ClosedRow {
  strategy_key: string
  realized_pnl_pct: number | null
  realized_pnl_usd: number | null
  notional_usd: number | null
  closed_at: string | null
}

interface ShadowRow {
  strategy_key: string
  realized_pnl_usd: number | null
  would_have_notional: number | null
}

/** Only fetch Brier for strategies that could plausibly promote — keeps the
 *  per-strategy query count bounded. */
const BRIER_FETCH_MIN_TRADES = 10
const MAX_BRIER_FETCHES = 15

export async function getPromotionPipeline(): Promise<PromotionPipelineRow[]> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const paperKeys = (Object.entries(STRATEGY_REGISTRY_CONFIG) as [StrategyKey, (typeof STRATEGY_REGISTRY_CONFIG)[StrategyKey]][])
      .filter(([, cfg]) => cfg.maturityStatus === 'paper_trading')
      .map(([key]) => key)

    const [{ data: closed }, { data: shadowClosed }] = await Promise.all([
      supabase
        .from('paper_positions')
        .select('strategy_key, realized_pnl_pct, realized_pnl_usd, notional_usd, closed_at').not('strategy_key', 'in', LADDER_KEYS_FILTER)
        .eq('user_id', user.id)
        .eq('status', 'closed')
        .limit(5000),
      supabase
        .from('shadow_positions')
        .select('strategy_key, realized_pnl_usd, would_have_notional')
        .eq('user_id', user.id)
        .eq('status', 'closed')
        .limit(5000),
    ])

    const closedByKey = new Map<string, ClosedRow[]>()
    for (const row of (closed ?? []) as ClosedRow[]) {
      if (!closedByKey.has(row.strategy_key)) closedByKey.set(row.strategy_key, [])
      closedByKey.get(row.strategy_key)!.push(row)
    }

    const shadowByKey = new Map<string, number[]>()
    for (const row of (shadowClosed ?? []) as ShadowRow[]) {
      if (typeof row.realized_pnl_usd !== 'number' || !(row.would_have_notional ?? 0)) continue
      if (!shadowByKey.has(row.strategy_key)) shadowByKey.set(row.strategy_key, [])
      shadowByKey.get(row.strategy_key)!.push(row.realized_pnl_usd / (row.would_have_notional as number))
    }

    const strategiesTested = Math.max(1, Object.keys(STRATEGY_REGISTRY_CONFIG).filter(k => (closedByKey.get(k)?.length ?? 0) > 0).length)

    // Brier only for strategies with meaningful trade history
    const brierCandidates = paperKeys
      .filter(k => (closedByKey.get(k)?.length ?? 0) >= BRIER_FETCH_MIN_TRADES)
      .slice(0, MAX_BRIER_FETCHES)
    const brierEntries = await Promise.all(
      brierCandidates.map(async k => [k, await getRollingBrier(supabase, k).catch(() => null)] as const),
    )
    const brierByKey = new Map(brierEntries)

    const rows: PromotionPipelineRow[] = paperKeys.map(key => {
      const cfg = STRATEGY_REGISTRY_CONFIG[key]
      const closedRows = closedByKey.get(key) ?? []
      const returns = closedRows
        .map(r => r.realized_pnl_pct)
        .filter((v): v is number => typeof v === 'number')

      const stats: PaperTradeStats = {
        closedTrades: closedRows.length,
        avgReturnPct: returns.length > 0 ? returns.reduce((s, v) => s + v, 0) / returns.length : null,
        maxDrawdownPct: computeDrawdown(closedRows),
        assetClass: cfg.assetClass,
        // Roadmap #4: "edge beyond luck", corrected for every strategy with a record.
        tradeReturnsPct: returns,
        strategiesTested,
      }

      const shadowReturns = shadowByKey.get(key) ?? []
      const shadow: ShadowComparison = {
        shadowAvgReturnPct: shadowReturns.length > 0
          ? shadowReturns.reduce((s, v) => s + v, 0) / shadowReturns.length
          : null,
        closedShadowTrades: shadowReturns.length,
      }

      const readiness = evaluatePaperToLive(
        key, stats, brierByKey.get(key)?.brierScore ?? null, shadow,
      )

      return {
        ...readiness,
        displayName: toDisplayName(key),
        passing: readiness.criteria.filter(c => c.evaluable && c.pass).length,
        totalCriteria: readiness.criteria.length,
      }
    })

    // Closest-to-ready first; strategies with zero trades sink to the bottom.
    rows.sort((a, b) => b.passing - a.passing)
    return rows
  } catch {
    return []
  }
}
