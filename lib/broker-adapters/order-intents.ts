/**
 * Order-intent persistence + idempotent submission wrappers.
 *
 * Every live order flows through here:
 *   1. Deterministic client_order_id per (opportunity, leg)
 *   2. An order_intents row is written BEFORE submission (status=pending)
 *   3. If an intent for the same id is already submitted/filled, we return the
 *      recorded result instead of resubmitting (concurrent-worker guard)
 *   4. Bounded retry (3 attempts, exponential backoff) reuses the same id;
 *      broker "duplicate order id" errors are treated as success
 *   5. All bracket leg ids are recorded so the reconciler can cancel siblings
 *      deterministically.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BrokerAdapter, OrderParams, BracketParams, BrokerResult, BracketResult } from './types'
import { clientOrderId, submitWithRetry, type OrderLeg, type RetryOptions } from './idempotency'

interface IntentContext {
  supabase: SupabaseClient
  userId: string
  opportunityId: string
  /** decision_log.id that produced this intent — relational provenance (W6). */
  decisionId?: string | null
  retry?: RetryOptions
}

interface IntentRowLite {
  status: string
  broker_order_id: string | null
  broker: string | null
}

async function findExistingIntent(
  ctx: IntentContext,
  cid: string
): Promise<IntentRowLite | null> {
  try {
    const { data } = await ctx.supabase
      .from('order_intents')
      .select('status, broker_order_id, broker')
      .eq('user_id', ctx.userId)
      .eq('client_order_id', cid)
    const rows = (data ?? []) as IntentRowLite[]
    return rows[0] ?? null
  } catch {
    return null
  }
}

async function upsertIntent(
  ctx: IntentContext,
  cid: string,
  leg: OrderLeg,
  fields: Record<string, unknown>
): Promise<void> {
  try {
    await ctx.supabase.from('order_intents').upsert(
      {
        user_id: ctx.userId,
        opportunity_id: ctx.opportunityId,
        client_order_id: cid,
        leg,
        ...(ctx.decisionId ? { decision_id: ctx.decisionId } : {}),
        updated_at: new Date().toISOString(),
        ...fields,
      },
      { onConflict: 'user_id,client_order_id' }
    )
  } catch (err) {
    console.warn('[order-intents] upsert failed:', err)
  }
}

/**
 * Idempotent single-order submission. Same opportunity twice → one order.
 */
export async function executeIdempotent(
  adapter: BrokerAdapter,
  params: OrderParams,
  ctx: IntentContext,
  leg: OrderLeg = 'entry'
): Promise<BrokerResult> {
  const cid = clientOrderId(ctx.opportunityId, leg)

  // Concurrent-worker / retry guard: an already-submitted intent is final.
  const existing = await findExistingIntent(ctx, cid)
  if (existing && ['submitted', 'filled', 'partially_filled'].includes(existing.status)) {
    return {
      status: 'submitted',
      broker: existing.broker ?? adapter.config.id,
      broker_order_id: existing.broker_order_id ?? undefined,
      reason: 'deduplicated: intent already submitted',
    }
  }

  await upsertIntent(ctx, cid, leg, {
    broker: adapter.config.id,
    symbol: params.symbol,
    side: params.side,
    notional_usd: params.notional_usd ?? null,
    quantity: params.quantity ?? null,
    status: 'pending',
  })

  const { result, attempts, dedupedAsSuccess } = await submitWithRetry<BrokerResult>(
    () => adapter.execute({ ...params, client_order_id: cid }),
    r => r.status === 'failed',
    r => r.error,
    r => ({ ...r, status: 'submitted', reason: 'duplicate client_order_id treated as success' }),
    ctx.retry
  )

  const ok = result.status === 'open' || result.status === 'submitted'
  await upsertIntent(ctx, cid, leg, {
    status: ok ? 'submitted' : result.status === 'skipped' ? 'cancelled' : 'failed',
    broker_order_id: result.broker_order_id ?? null,
    attempts,
    error: result.error ?? null,
    ...(dedupedAsSuccess ? { error: 'deduped: duplicate client_order_id' } : {}),
  })

  return result
}

/**
 * Idempotent bracket submission — records intents for ALL legs so the
 * reconciler can verify legs exist and cancel siblings by recorded id.
 */
export async function placeBracketIdempotent(
  adapter: BrokerAdapter,
  params: BracketParams,
  ctx: IntentContext
): Promise<BracketResult> {
  const entryCid = clientOrderId(ctx.opportunityId, 'entry')

  const existing = await findExistingIntent(ctx, entryCid)
  if (existing && ['submitted', 'filled', 'partially_filled'].includes(existing.status)) {
    return {
      status: 'submitted',
      broker: existing.broker ?? adapter.config.id,
      parent_order_id: existing.broker_order_id ?? undefined,
      reason: 'deduplicated: intent already submitted',
    }
  }

  await upsertIntent(ctx, entryCid, 'entry', {
    broker: adapter.config.id,
    symbol: params.symbol,
    side: params.side,
    notional_usd: params.notional_usd ?? null,
    quantity: params.quantity ?? null,
    status: 'pending',
  })

  const { result, attempts, dedupedAsSuccess } = await submitWithRetry<BracketResult>(
    () => adapter.placeBracketOrder({ ...params, client_order_id: entryCid }),
    r => r.status === 'failed',
    r => r.error,
    r => ({ ...r, status: 'submitted', reason: 'duplicate client_order_id treated as success' }),
    ctx.retry
  )

  const ok = result.status === 'submitted'
  await upsertIntent(ctx, entryCid, 'entry', {
    status: ok ? 'submitted' : result.status === 'skipped' ? 'cancelled' : 'failed',
    broker_order_id: result.parent_order_id ?? null,
    attempts,
    error: result.error ?? null,
    ...(dedupedAsSuccess ? { error: 'deduped: duplicate client_order_id' } : {}),
  })

  // Record both bracket legs (even when the broker call failed to return ids —
  // a null broker_order_id is exactly what the reconciler flags as a gap).
  if (ok) {
    if (params.stop_price || params.stop_pct || params.trail_pct) {
      await upsertIntent(ctx, clientOrderId(ctx.opportunityId, 'stop'), 'stop', {
        broker: adapter.config.id,
        symbol: params.symbol,
        side: params.side === 'buy' ? 'sell' : 'buy',
        quantity: params.quantity ?? null,
        stop_price: params.stop_price ?? null,
        limit_price: params.stop_price ?? null,
        status: result.stop_order_id ? 'submitted' : 'pending',
        broker_order_id: result.stop_order_id ?? null,
      })
    }
    if (params.take_profit_price || params.target_pct) {
      await upsertIntent(ctx, clientOrderId(ctx.opportunityId, 'take_profit'), 'take_profit', {
        broker: adapter.config.id,
        symbol: params.symbol,
        side: params.side === 'buy' ? 'sell' : 'buy',
        quantity: params.quantity ?? null,
        limit_price: params.take_profit_price ?? null,
        status: result.take_profit_order_id ? 'submitted' : 'pending',
        broker_order_id: result.take_profit_order_id ?? null,
      })
    }
  }

  return result
}
