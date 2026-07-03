/**
 * Runtime kill switch — the single pre-trade gate both execution paths must
 * pass before ANY order reaches a broker adapter.
 *
 * Blocks when:
 *   1. The global/user `trading_halted` flag is set (system_flags table)
 *   2. The signal's sleeve is halted (portfolio_sleeves.halted)
 *   3. Portfolio drawdown from high-water mark exceeds risk_controls.max_drawdown_pct
 *   4. Today's realized loss exceeds risk_controls.daily_loss_limit_usd
 *
 * FAILS CLOSED: if the state needed for a check cannot be read (missing
 * migration, query error), the trade is blocked with an explicit reason —
 * never silently allowed. Callers must log blocked trades to the audit trail.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getRiskControl, getPortfolioUsd } from '@/lib/strategies/risk-controls'

export interface RiskCheckResult {
  allowed: boolean
  reason?: string
}

export interface PreTradeContext {
  supabase: SupabaseClient
  userId: string
  /** Strategy key of the signal — used to match halted sleeves. */
  strategyKey?: string
  /** Explicit sleeve the trade belongs to, when known. */
  sleeveId?: string
}

// ─── Pure evaluation (exported for tests) ────────────────────────────────────

export interface KillSwitchInputs {
  globalHalted: boolean
  globalHaltReason?: string | null
  sleeveHalted: boolean
  haltedSleeveId?: string
  /** Current portfolio drawdown from high-water mark, in percent (≥ 0). */
  drawdownPct: number
  maxDrawdownPct: number
  /** Today's realized P&L in USD (negative = loss). */
  dailyRealizedPnlUsd: number
  dailyLossLimitUsd?: number | null
}

export function evaluateKillSwitch(i: KillSwitchInputs): RiskCheckResult {
  if (i.globalHalted) {
    return { allowed: false, reason: `trading_halted${i.globalHaltReason ? `: ${i.globalHaltReason}` : ''}` }
  }
  if (i.sleeveHalted) {
    return { allowed: false, reason: `sleeve_halted${i.haltedSleeveId ? `: ${i.haltedSleeveId}` : ''}` }
  }
  if (i.drawdownPct > i.maxDrawdownPct) {
    return {
      allowed: false,
      reason: `max_drawdown_breached: ${i.drawdownPct.toFixed(1)}% > ${i.maxDrawdownPct}% limit`,
    }
  }
  if (
    i.dailyLossLimitUsd != null &&
    i.dailyRealizedPnlUsd < 0 &&
    Math.abs(i.dailyRealizedPnlUsd) > i.dailyLossLimitUsd
  ) {
    return {
      allowed: false,
      reason: `daily_loss_limit_breached: $${Math.abs(i.dailyRealizedPnlUsd).toFixed(0)} loss > $${i.dailyLossLimitUsd} limit`,
    }
  }
  return { allowed: true }
}

/**
 * Drawdown from high-water mark, in percent of peak equity.
 *
 * @param baseEquityUsd       Account equity before any recorded P&L
 * @param dailyRealizedUsd    Realized P&L per day, chronological order
 * @param openUnrealizedUsd   Current unrealized P&L of open positions
 */
export function computeDrawdownPct(
  baseEquityUsd: number,
  dailyRealizedUsd: number[],
  openUnrealizedUsd: number
): number {
  if (!Number.isFinite(baseEquityUsd) || baseEquityUsd <= 0) return 0
  let equity = baseEquityUsd
  let peak = baseEquityUsd
  for (const pnl of dailyRealizedUsd) {
    equity += pnl
    if (equity > peak) peak = equity
  }
  const current = equity + openUnrealizedUsd
  if (peak <= 0) return 0
  return Math.max(0, ((peak - current) / peak) * 100)
}

// ─── State gathering + check ─────────────────────────────────────────────────

interface FlagRow { user_id: string | null; enabled: boolean; reason: string | null }
interface SleeveRow { id: string; halted: boolean; approved_strategies: string[] | null }
interface ClosedRow { closed_at: string | null; realized_pnl_usd: number | null }
interface OpenRow { unrealized_pnl_usd: number | null }

export async function preTradeRiskCheck(ctx: PreTradeContext): Promise<RiskCheckResult> {
  const { supabase, userId, strategyKey, sleeveId } = ctx

  // ── 1. Global / per-user trading_halted flag — fail closed on read error ──
  let globalHalted = false
  let globalHaltReason: string | null = null
  try {
    const { data, error } = await supabase
      .from('system_flags')
      .select('user_id, enabled, reason')
      .eq('key', 'trading_halted')
    if (error) {
      return { allowed: false, reason: `kill_switch_unavailable: system_flags read failed (${error.message})` }
    }
    for (const row of (data ?? []) as FlagRow[]) {
      if (row.enabled && (row.user_id === null || row.user_id === userId)) {
        globalHalted = true
        globalHaltReason = row.reason
        break
      }
    }
  } catch (err) {
    return { allowed: false, reason: `kill_switch_unavailable: ${err instanceof Error ? err.message : err}` }
  }

  // ── 2. Sleeve halt — a halted sleeve blocks its strategies ────────────────
  let sleeveHalted = false
  let haltedSleeveId: string | undefined
  try {
    const { data, error } = await supabase
      .from('portfolio_sleeves')
      .select('id, halted, approved_strategies')
      .eq('user_id', userId)
      .eq('halted', true)
    if (error) {
      return { allowed: false, reason: `kill_switch_unavailable: sleeves read failed (${error.message})` }
    }
    for (const s of (data ?? []) as SleeveRow[]) {
      const matchesSleeve = sleeveId != null && s.id === sleeveId
      const matchesStrategy =
        strategyKey != null && (s.approved_strategies ?? []).includes(strategyKey)
      if (matchesSleeve || matchesStrategy) {
        sleeveHalted = true
        haltedSleeveId = s.id
        break
      }
    }
  } catch (err) {
    return { allowed: false, reason: `kill_switch_unavailable: ${err instanceof Error ? err.message : err}` }
  }

  // ── 3+4. Drawdown & daily loss from recorded closes ───────────────────────
  let drawdownPct = 0
  let dailyRealizedPnlUsd = 0
  let maxDrawdownPct = 20
  let dailyLossLimitUsd: number | null | undefined
  try {
    const rc = await getRiskControl(supabase, userId)
    maxDrawdownPct = rc.max_drawdown_pct
    dailyLossLimitUsd = rc.daily_loss_limit_usd

    const [closedRes, openRes] = await Promise.all([
      supabase
        .from('paper_positions')
        .select('closed_at, realized_pnl_usd')
        .eq('user_id', userId)
        .eq('status', 'closed'),
      supabase
        .from('paper_positions')
        .select('unrealized_pnl_usd')
        .eq('user_id', userId)
        .eq('status', 'open'),
    ])
    if (closedRes.error || openRes.error) {
      const msg = closedRes.error?.message ?? openRes.error?.message
      return { allowed: false, reason: `kill_switch_unavailable: positions read failed (${msg})` }
    }

    const byDay = new Map<string, number>()
    const todayUtc = new Date().toISOString().slice(0, 10)
    for (const row of ((closedRes.data ?? []) as ClosedRow[])) {
      if (!row.closed_at) continue
      const day = row.closed_at.slice(0, 10)
      const pnl = row.realized_pnl_usd ?? 0
      byDay.set(day, (byDay.get(day) ?? 0) + pnl)
      if (day === todayUtc) dailyRealizedPnlUsd += pnl
    }
    const series = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v)
    const unrealized = ((openRes.data ?? []) as OpenRow[])
      .reduce((s, r) => s + (r.unrealized_pnl_usd ?? 0), 0)

    // Null equity → drawdown ratio can't be computed (sizing refuses to trade
    // in that state anyway); the flag/sleeve/daily-loss checks still apply.
    const baseEquityUsd = await getPortfolioUsd(supabase, userId)
    drawdownPct = computeDrawdownPct(baseEquityUsd ?? 0, series, unrealized)
  } catch (err) {
    return { allowed: false, reason: `kill_switch_unavailable: ${err instanceof Error ? err.message : err}` }
  }

  return evaluateKillSwitch({
    globalHalted,
    globalHaltReason,
    sleeveHalted,
    haltedSleeveId,
    drawdownPct,
    maxDrawdownPct,
    dailyRealizedPnlUsd,
    dailyLossLimitUsd,
  })
}
