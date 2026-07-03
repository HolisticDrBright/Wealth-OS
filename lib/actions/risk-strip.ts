'use server'

/**
 * Risk Strip data + Flatten & Halt actions (UI brief widgets 1 and 3).
 *
 * Reads the SAME sources the kill switch enforces — one source of truth:
 * system_flags.trading_halted, risk_controls limits, paper_positions
 * drawdown/daily P&L, order_intents pending orders.
 */

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getRiskControl } from '@/lib/strategies/risk-controls'
import { computeDrawdownPct } from '@/lib/risk/kill-switch'
import { roundTripCostUsd } from '@/lib/costs/transaction-costs'

export interface RiskStripData {
  /** Always 'paper' until live trading exists. */
  mode: 'paper' | 'live'
  tradingHalted: boolean
  haltReason: string | null
  drawdownPct: number
  maxDrawdownPct: number
  dailyPnlUsd: number
  dailyLossLimitUsd: number | null
  openPositions: number
  exposureByClass: Array<{ assetClass: string; notionalUsd: number }>
  fetchedAt: string
}

interface ClosedRow { closed_at: string | null; realized_pnl_usd: number | null }
interface OpenRow { asset_class: string; notional_usd: number | null; unrealized_pnl_usd: number | null }

export async function getRiskStripData(): Promise<RiskStripData | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [flagsRes, closedRes, openRes, rc, assetsRes] = await Promise.all([
    supabase.from('system_flags').select('user_id, enabled, reason').eq('key', 'trading_halted'),
    supabase.from('paper_positions').select('closed_at, realized_pnl_usd').eq('user_id', user.id).eq('status', 'closed'),
    supabase.from('paper_positions').select('asset_class, notional_usd, unrealized_pnl_usd').eq('user_id', user.id).eq('status', 'open'),
    getRiskControl(supabase, user.id),
    supabase.from('assets').select('current_value').eq('user_id', user.id),
  ])

  const flags = (flagsRes.data ?? []) as Array<{ user_id: string | null; enabled: boolean; reason: string | null }>
  const halted = flags.find(f => f.enabled && (f.user_id === null || f.user_id === user.id))

  // Same drawdown math the kill switch enforces.
  const byDay = new Map<string, number>()
  const todayUtc = new Date().toISOString().slice(0, 10)
  let dailyPnlUsd = 0
  for (const row of ((closedRes.data ?? []) as ClosedRow[])) {
    if (!row.closed_at) continue
    const day = row.closed_at.slice(0, 10)
    const pnl = row.realized_pnl_usd ?? 0
    byDay.set(day, (byDay.get(day) ?? 0) + pnl)
    if (day === todayUtc) dailyPnlUsd += pnl
  }
  const series = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v)

  const open = (openRes.data ?? []) as OpenRow[]
  const unrealized = open.reduce((s, r) => s + (r.unrealized_pnl_usd ?? 0), 0)
  const baseEquity = ((assetsRes.data ?? []) as Array<{ current_value: number }>)
    .reduce((s, r) => s + (r.current_value ?? 0), 0)
  const drawdownPct = computeDrawdownPct(baseEquity, series, unrealized)

  const byClass = new Map<string, number>()
  for (const r of open) {
    byClass.set(r.asset_class, (byClass.get(r.asset_class) ?? 0) + (r.notional_usd ?? 0))
  }

  return {
    mode: 'paper',
    tradingHalted: !!halted,
    haltReason: halted?.reason ?? null,
    drawdownPct: Math.round(drawdownPct * 100) / 100,
    maxDrawdownPct: rc.max_drawdown_pct,
    dailyPnlUsd: Math.round(dailyPnlUsd * 100) / 100,
    dailyLossLimitUsd: rc.daily_loss_limit_usd ?? null,
    openPositions: open.length,
    exposureByClass: [...byClass.entries()]
      .map(([assetClass, notionalUsd]) => ({ assetClass, notionalUsd: Math.round(notionalUsd) }))
      .sort((a, b) => b.notionalUsd - a.notionalUsd),
    fetchedAt: new Date().toISOString(),
  }
}

export interface HaltImpact {
  openPositions: number
  openNotionalUsd: number
  estimatedExitCostUsd: number
  pendingOrders: number
}

/** Two-step confirm: show the impact BEFORE the flag is set. */
export async function getHaltImpact(): Promise<HaltImpact | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [openRes, intentsRes] = await Promise.all([
    supabase.from('paper_positions')
      .select('asset_class, notional_usd')
      .eq('user_id', user.id).eq('status', 'open'),
    supabase.from('order_intents')
      .select('id')
      .eq('user_id', user.id)
      .in('status', ['pending', 'submitted', 'partially_filled']),
  ])

  const open = (openRes.data ?? []) as Array<{ asset_class: string; notional_usd: number | null }>
  const openNotionalUsd = open.reduce((s, r) => s + (r.notional_usd ?? 0), 0)
  const estimatedExitCostUsd = open.reduce(
    (s, r) => s + roundTripCostUsd(r.notional_usd ?? 0, r.asset_class) / 2,  // one-way exit
    0
  )

  return {
    openPositions: open.length,
    openNotionalUsd: Math.round(openNotionalUsd),
    estimatedExitCostUsd: Math.round(estimatedExitCostUsd * 100) / 100,
    pendingOrders: (intentsRes.data ?? []).length,
  }
}

/**
 * Sets the user's trading_halted flag. Enforcement is the Phase 0 kill
 * switch — this only flips the flag it reads.
 */
export async function setTradingHalted(
  halted: boolean,
  reason: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not authenticated' }

  // One row per (user, key): update if present, insert otherwise.
  const { data: existing } = await supabase
    .from('system_flags')
    .select('id')
    .eq('key', 'trading_halted')
    .eq('user_id', user.id)

  const row = {
    enabled: halted,
    reason: halted ? (reason || 'manual Flatten & Halt') : null,
    updated_at: new Date().toISOString(),
  }
  const first = (existing ?? [])[0] as { id: string } | undefined
  const { error } = first
    ? await supabase.from('system_flags').update(row).eq('id', first.id)
    : await supabase.from('system_flags').insert({ user_id: user.id, key: 'trading_halted', ...row })

  if (error) return { ok: false, error: error.message }
  revalidatePath('/', 'layout')
  return { ok: true }
}
