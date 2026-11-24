/**
 * Pause / resume core (Phase M4 + web Flatten & Halt) — client-agnostic.
 * ONE implementation of "stop everything" shared by the web risk strip and
 * the mobile Pause screen:
 *   1. set the trading_halted flag FIRST (kill switch blocks new orders),
 *   2. cancel pending order intents (they stop being placed either way; the
 *      rows are marked so the UI promise "pending orders cancelled" is true),
 *   3. optionally close every open Explore (strategy) position — Core and
 *      Tier 1 Safety fund positions are NEVER sold by a pause (Phase 3;
 *      PaperBroker.flattenAllPositions skips the reserved ladder keys),
 *   4. write the audit_logs row.
 * Resume only flips the flag back and is meant to sit behind an explicit
 * confirmation step in every UI.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface PauseResult {
  ok: boolean
  closed: number
  cancelledOrders: number
  failures: string[]
  error?: string
}

async function setHaltFlag(
  supabase: SupabaseClient,
  userId: string,
  halted: boolean,
  reason: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: existing } = await supabase
    .from('system_flags')
    .select('id')
    .eq('key', 'trading_halted')
    .eq('user_id', userId)

  const row = {
    enabled: halted,
    reason: halted ? (reason || 'paused by user') : null,
    updated_at: new Date().toISOString(),
  }
  const first = (existing ?? [])[0] as { id: string } | undefined
  const { error } = first
    ? await supabase.from('system_flags').update(row).eq('id', first.id)
    : await supabase.from('system_flags').insert({ user_id: userId, key: 'trading_halted', ...row })
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function pauseTradingCore(
  supabase: SupabaseClient,
  userId: string,
  args: { sellExplore: boolean; reason: string }
): Promise<PauseResult> {
  // 1. Halt first — nothing new while we work.
  const halt = await setHaltFlag(supabase, userId, true, args.reason)
  if (!halt.ok) return { ok: false, closed: 0, cancelledOrders: 0, failures: [], error: halt.error }

  // 2. Cancel pending order intents.
  let cancelledOrders = 0
  const { data: cancelled } = await supabase
    .from('order_intents')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .in('status', ['pending', 'submitted', 'partially_filled'])
    .select('id')
  cancelledOrders = (cancelled ?? []).length

  // 3. Optionally sell Explore: close every open STRATEGY position. Core and
  // Safety fund positions are left exactly as they are.
  let closed = 0
  let failures: string[] = []
  if (args.sellExplore) {
    try {
      const { PaperBroker } = await import('@/lib/paper-trading/PaperBroker')
      const res = await new PaperBroker().flattenAllPositions(supabase, userId, 'manual_flatten')
      closed = res.closed
      failures = res.failures
    } catch (err) {
      failures = [err instanceof Error ? err.message : 'flatten failed']
    }
  }

  // 4. Audit trail.
  await supabase.from('audit_logs').insert({
    user_id: userId, strategy_key: 'flatten_halt', symbol: 'ALL',
    decision: 'halt', size_fraction: 0, mirofish_used: false, kronos_used: false,
    decided_at: new Date().toISOString(),
    metadata: {
      reason: args.reason, sell_explore: args.sellExplore,
      positions_closed: closed, orders_cancelled: cancelledOrders, failures,
    },
  }).then(() => {}, () => {})

  return { ok: failures.length === 0, closed, cancelledOrders, failures }
}

export async function resumeTradingCore(
  supabase: SupabaseClient,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await setHaltFlag(supabase, userId, false, '')
  if (res.ok) {
    await supabase.from('audit_logs').insert({
      user_id: userId, strategy_key: 'flatten_halt', symbol: 'ALL',
      decision: 'resume', size_fraction: 0, mirofish_used: false, kronos_used: false,
      decided_at: new Date().toISOString(),
      metadata: { action: 'resume trading' },
    }).then(() => {}, () => {})
  }
  return res
}
