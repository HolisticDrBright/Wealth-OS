/**
 * Core / Safety paper execution (Phase 3). Executes FundTrade plans from
 * core-plans.ts as paper positions tagged with the reserved ladder keys
 * (lib/allocation/sleeves.ts). Paper only — no broker is ever called.
 *
 * Buys open a new lot. Sells close lots first-in-first-out; a partial sell
 * splits the lot so the sold part becomes a CLOSED row with its realized
 * P&L (every existing P&L reader then sees it correctly) and the open row
 * keeps the remainder.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchCurrentPrice } from '@/lib/paper-trading/price-feed'
import { oneWayCostBps } from '@/lib/costs/transaction-costs'
import {
  CORE_STRATEGY_KEY, SAFETY_STRATEGY_KEY, LADDER_NO_EXIT, type LadderSleeve,
} from '@/lib/allocation/sleeves'
import { FUND_COST_CLASS, type FundTrade } from '@/lib/allocation/core-plans'
import type { LadderHoldings } from '@/lib/allocation/ladder'

const FUND_ASSET_CLASS = FUND_COST_CLASS   // ETFs price and cost like stocks

export function keyForSleeve(sleeve: LadderSleeve): string {
  return sleeve === 'core' ? CORE_STRATEGY_KEY : SAFETY_STRATEGY_KEY
}

interface LadderRow {
  id: string
  strategy_key: string
  symbol: string
  status: string
  quantity: number | string
  entry_price: number | string
  current_price: number | string | null
  notional_usd: number | string
  realized_pnl_usd: number | string | null
  opened_at: string
}

const num = (v: number | string | null | undefined) => (v == null ? 0 : Number(v))

/** Market value + P&L of the user's Core / Safety rows. */
export async function loadLadderHoldings(supabase: SupabaseClient, userId: string): Promise<LadderHoldings> {
  const { data, error } = await supabase
    .from('paper_positions')
    .select('id, strategy_key, symbol, status, quantity, entry_price, current_price, notional_usd, realized_pnl_usd, opened_at')
    .eq('user_id', userId)
    .in('strategy_key', [CORE_STRATEGY_KEY, SAFETY_STRATEGY_KEY])
  if (error || !data) return { safetyUsd: 0, coreBySymbol: {}, ladderPnlUsd: 0, hasCorePositions: false }

  let safetyUsd = 0
  let ladderPnlUsd = 0
  let hasCorePositions = false
  const coreBySymbol: Record<string, number> = {}
  for (const r of data as LadderRow[]) {
    if (r.status === 'open') {
      const price = r.current_price != null ? num(r.current_price) : num(r.entry_price)
      const value = num(r.quantity) * price
      ladderPnlUsd += value - num(r.notional_usd)
      if (r.strategy_key === SAFETY_STRATEGY_KEY) safetyUsd += value
      else {
        coreBySymbol[r.symbol] = (coreBySymbol[r.symbol] ?? 0) + value
        hasCorePositions = true
      }
    } else {
      ladderPnlUsd += num(r.realized_pnl_usd)
    }
  }
  return { safetyUsd, coreBySymbol, ladderPnlUsd, hasCorePositions }
}

export interface FundTradeResult {
  trade: FundTrade
  ok: boolean
  error?: string
  fillPrice?: number
}

async function buy(supabase: SupabaseClient, userId: string, t: FundTrade, reason: string, price: number): Promise<FundTradeResult> {
  const bps = oneWayCostBps(FUND_ASSET_CLASS)
  const fill = price * (1 + bps / 10_000)
  const quantity = t.usd / fill
  const { data: pos, error } = await supabase.from('paper_positions').insert({
    user_id: userId,
    strategy_key: keyForSleeve(t.sleeve),
    symbol: t.symbol,
    asset_class: FUND_ASSET_CLASS,
    direction: 'long',
    entry_price: fill,
    current_price: price,
    quantity,
    notional_usd: t.usd,
    status: 'open',
    ...LADDER_NO_EXIT,
    metadata: { sleeve: t.sleeve, reason },
  }).select('id').single()
  if (error || !pos) return { trade: t, ok: false, error: error?.message ?? 'insert failed' }

  await supabase.from('paper_trades').insert({
    user_id: userId, position_id: (pos as { id: string }).id,
    strategy_key: keyForSleeve(t.sleeve), symbol: t.symbol, asset_class: FUND_ASSET_CLASS,
    direction: 'long', side: 'open', fill_price: fill, quantity, notional_usd: t.usd,
    slippage_bps: bps, metadata: { sleeve: t.sleeve, reason },
  }).then(() => {}, () => {})
  return { trade: t, ok: true, fillPrice: fill }
}

async function closeRow(supabase: SupabaseClient, id: string, fields: Record<string, unknown>) {
  // 'rebalance' needs migration 20260704m; fall back to the always-valid 'manual'.
  let { error } = await supabase.from('paper_positions').update({ ...fields, exit_reason: 'rebalance' }).eq('id', id)
  if (error && /exit_reason|check constraint/i.test(error.message ?? '')) {
    ({ error } = await supabase.from('paper_positions').update({ ...fields, exit_reason: 'manual' }).eq('id', id))
  }
  return error
}

async function sell(supabase: SupabaseClient, userId: string, t: FundTrade, reason: string, price: number): Promise<FundTradeResult> {
  const bps = oneWayCostBps(FUND_ASSET_CLASS)
  const fill = price * (1 - bps / 10_000)
  let qtyLeft = t.usd / price

  const { data: lots, error } = await supabase
    .from('paper_positions')
    .select('id, quantity, entry_price, notional_usd, opened_at')
    .eq('user_id', userId)
    .eq('strategy_key', keyForSleeve(t.sleeve))
    .eq('symbol', t.symbol)
    .eq('status', 'open')
    .order('opened_at', { ascending: true })
  if (error) return { trade: t, ok: false, error: error.message }

  const now = new Date().toISOString()
  for (const lot of (lots ?? []) as Array<{ id: string; quantity: number | string; entry_price: number | string; notional_usd: number | string; opened_at: string }>) {
    if (qtyLeft <= 1e-9) break
    const lotQty = num(lot.quantity)
    const entry = num(lot.entry_price)
    const q = Math.min(lotQty, qtyLeft)
    const pnl = (fill - entry) * q
    const soldNotional = entry * q
    const closed = {
      status: 'closed', closed_at: now, current_price: price, exit_price: fill,
      realized_pnl_usd: pnl, realized_pnl_pct: soldNotional > 0 ? pnl / soldNotional : 0,
      unrealized_pnl_usd: null, unrealized_pnl_pct: null,
    }
    if (q >= lotQty - 1e-9) {
      const err = await closeRow(supabase, lot.id, closed)
      if (err) return { trade: t, ok: false, error: err.message }
    } else {
      // Partial: shrink the open lot, record the sold part as its own closed row.
      const remaining = lotQty - q
      const { error: shrinkErr } = await supabase.from('paper_positions')
        .update({ quantity: remaining, notional_usd: entry * remaining }).eq('id', lot.id)
      if (shrinkErr) return { trade: t, ok: false, error: shrinkErr.message }
      const { data: part, error: partErr } = await supabase.from('paper_positions').insert({
        user_id: userId, strategy_key: keyForSleeve(t.sleeve), symbol: t.symbol,
        asset_class: FUND_ASSET_CLASS, direction: 'long', opened_at: lot.opened_at,
        entry_price: entry, quantity: q, notional_usd: soldNotional, status: 'open',
        ...LADDER_NO_EXIT, metadata: { sleeve: t.sleeve, reason, split_from: lot.id },
      }).select('id').single()
      if (partErr || !part) return { trade: t, ok: false, error: partErr?.message ?? 'split failed' }
      const err = await closeRow(supabase, (part as { id: string }).id, closed)
      if (err) return { trade: t, ok: false, error: err.message }
    }
    qtyLeft -= q
  }
  if (qtyLeft > 1e-6) return { trade: t, ok: false, error: `not enough ${t.symbol} held to sell $${t.usd}` }

  await supabase.from('paper_trades').insert({
    user_id: userId, strategy_key: keyForSleeve(t.sleeve), symbol: t.symbol, asset_class: FUND_ASSET_CLASS,
    direction: 'long', side: 'close', fill_price: fill, quantity: t.usd / price, notional_usd: t.usd,
    slippage_bps: bps, metadata: { sleeve: t.sleeve, reason },
  }).then(() => {}, () => {})
  return { trade: t, ok: true, fillPrice: fill }
}

/**
 * Execute a plan in order (sells before buys so buys are funded). Paper only.
 * Each trade succeeds or is reported — never silently dropped.
 */
export async function executeFundTrades(
  supabase: SupabaseClient,
  userId: string,
  trades: FundTrade[],
  reason: 'setup' | 'deposit' | 'rebalance',
): Promise<{ results: FundTradeResult[]; failures: string[] }> {
  const prices = new Map<string, number | null>()
  for (const sym of new Set(trades.map(t => t.symbol))) {
    prices.set(sym, await fetchCurrentPrice(sym, FUND_ASSET_CLASS as never).catch(() => null))
  }
  const results: FundTradeResult[] = []
  for (const t of trades) {
    const price = prices.get(t.symbol)
    if (price == null || !(price > 0)) {
      results.push({ trade: t, ok: false, error: `no price for ${t.symbol}` })
      continue
    }
    results.push(t.side === 'buy'
      ? await buy(supabase, userId, t, reason, price)
      : await sell(supabase, userId, t, reason, price))
  }
  return {
    results,
    failures: results.filter(r => !r.ok).map(r => `${r.trade.side} ${r.trade.symbol} $${r.trade.usd}: ${r.error}`),
  }
}

/**
 * Daily mark-to-market for Core / Safety fund positions. The strategy exit
 * sweep (PaperBroker.checkAndExitPositions) deliberately skips ladder rows,
 * so their prices are refreshed here instead — price + unrealized P&L only.
 * This NEVER opens, closes, or resizes anything. Pass a userId to scope it;
 * the cron passes none (admin client, every user).
 */
export async function markLadderPositions(
  supabase: SupabaseClient,
  userId?: string,
): Promise<{ marked: number; unpriced: string[] }> {
  let q = supabase
    .from('paper_positions')
    .select('id, symbol, quantity, notional_usd, entry_price')
    .in('strategy_key', [CORE_STRATEGY_KEY, SAFETY_STRATEGY_KEY])
    .eq('status', 'open')
  if (userId) q = q.eq('user_id', userId)
  const { data } = await q
  const rows = (data ?? []) as Array<{ id: string; symbol: string; quantity: number | string; notional_usd: number | string; entry_price: number | string }>
  const prices = new Map<string, number | null>()
  for (const sym of new Set(rows.map(r => r.symbol))) {
    prices.set(sym, await fetchCurrentPrice(sym, FUND_ASSET_CLASS as never).catch(() => null))
  }
  let marked = 0
  const unpriced: string[] = []
  for (const r of rows) {
    const price = prices.get(r.symbol)
    if (price == null || !(price > 0)) { if (!unpriced.includes(r.symbol)) unpriced.push(r.symbol); continue }
    const value = num(r.quantity) * price
    const pnl = value - num(r.notional_usd)
    const { error } = await supabase.from('paper_positions').update({
      current_price: price,
      unrealized_pnl_usd: pnl,
      unrealized_pnl_pct: num(r.notional_usd) > 0 ? pnl / num(r.notional_usd) : 0,
    }).eq('id', r.id)
    if (!error) marked++
  }
  return { marked, unpriced }
}
