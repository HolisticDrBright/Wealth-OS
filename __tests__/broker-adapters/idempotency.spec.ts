/**
 * Idempotent orders + OCO reconciliation.
 *
 * Old behavior (proven wrong here): client_order_id was `wos-${Date.now()}`,
 * so a retry or concurrent worker got a fresh id and the broker accepted a
 * duplicate order. Coinbase bracket legs relied on a 30s poll with no record
 * of sibling ids — a fill in the gap orphaned the survivor.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  clientOrderId,
  isDuplicateOrderError,
  submitWithRetry,
} from '@/lib/broker-adapters/idempotency'
import { executeIdempotent } from '@/lib/broker-adapters/order-intents'
import {
  planReconciliation,
  type OrderIntentRow,
  type BrokerOrderStatus,
} from '@/lib/broker-adapters/reconciler'
import type { BrokerAdapter, BrokerResult } from '@/lib/broker-adapters/types'

// ─── clientOrderId ────────────────────────────────────────────────────────────

describe('clientOrderId', () => {
  it('is deterministic per opportunity — same input, same id, every time', () => {
    const a = clientOrderId('opp-123')
    const b = clientOrderId('opp-123')
    expect(a).toBe(b)
    expect(a).toMatch(/^wos-[0-9a-f]{20}$/)
  })

  it('differs across opportunities and across legs', () => {
    expect(clientOrderId('opp-1')).not.toBe(clientOrderId('opp-2'))
    expect(clientOrderId('opp-1', 'entry')).not.toBe(clientOrderId('opp-1', 'stop'))
    expect(clientOrderId('opp-1', 'stop')).not.toBe(clientOrderId('opp-1', 'take_profit'))
  })
})

describe('isDuplicateOrderError', () => {
  it('matches broker duplicate-id messages', () => {
    expect(isDuplicateOrderError('DUPLICATE_CLIENT_ORDER_ID')).toBe(true)
    expect(isDuplicateOrderError('client order id already exists')).toBe(true)
    expect(isDuplicateOrderError('Idempotency conflict')).toBe(true)
    expect(isDuplicateOrderError('insufficient funds')).toBe(false)
    expect(isDuplicateOrderError(undefined)).toBe(false)
  })
})

// ─── submitWithRetry ──────────────────────────────────────────────────────────

describe('submitWithRetry', () => {
  const noSleep = () => Promise.resolve()

  it('retries a network failure up to 3 attempts, then succeeds', async () => {
    let calls = 0
    const submit = vi.fn(async (): Promise<BrokerResult> => {
      calls++
      if (calls < 3) return { status: 'failed', error: 'ECONNRESET' }
      return { status: 'open', broker_order_id: 'ord-1' }
    })
    const out = await submitWithRetry<BrokerResult>(
      submit, r => r.status === 'failed', r => r.error, r => r, { sleep: noSleep }
    )
    expect(out.attempts).toBe(3)
    expect(out.result.status).toBe('open')
  })

  it('stops after 3 attempts on persistent failure', async () => {
    const submit = vi.fn(async (): Promise<BrokerResult> => ({ status: 'failed', error: 'boom' }))
    const out = await submitWithRetry<BrokerResult>(
      submit, r => r.status === 'failed', r => r.error, r => r, { sleep: noSleep }
    )
    expect(submit).toHaveBeenCalledTimes(3)
    expect(out.result.status).toBe('failed')
  })

  it('treats a duplicate-order-id rejection as SUCCESS (the earlier attempt landed)', async () => {
    const submit = vi.fn(async (): Promise<BrokerResult> => ({
      status: 'failed',
      error: 'DUPLICATE_CLIENT_ORDER_ID',
    }))
    const out = await submitWithRetry<BrokerResult>(
      submit,
      r => r.status === 'failed',
      r => r.error,
      r => ({ ...r, status: 'submitted' as const }),
      { sleep: noSleep }
    )
    expect(submit).toHaveBeenCalledTimes(1)  // no pointless retries
    expect(out.dedupedAsSuccess).toBe(true)
    expect(out.result.status).toBe('submitted')
  })
})

// ─── executeIdempotent ────────────────────────────────────────────────────────

type Row = Record<string, unknown>

function makeSupabase(intentRows: Row[] = []) {
  const upserts: Row[] = []
  return {
    _upserts: upserts,
    from: vi.fn((table: string) => {
      const result = { data: table === 'order_intents' ? intentRows : [], error: null }
      const builder: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) => resolve(result),
      }
      for (const m of ['select', 'eq', 'in']) builder[m] = () => builder
      builder.upsert = (row: Row) => { upserts.push(row); return Promise.resolve({ error: null }) }
      builder.update = () => builder
      return builder
    }),
  } as never
}

function fakeAdapter(execute: () => Promise<BrokerResult>): BrokerAdapter {
  return {
    config: { id: 'coinbase', displayName: 'CB', assetClasses: ['crypto'], requiredEnvVars: [] },
    execute,
  } as unknown as BrokerAdapter
}

describe('executeIdempotent', () => {
  it('same opportunity twice → ONE broker order (second call deduped from intents)', async () => {
    const execute = vi.fn(async (): Promise<BrokerResult> => ({ status: 'open', broker_order_id: 'ord-9' }))
    const adapter = fakeAdapter(execute)
    const params = { symbol: 'BTC', asset_class: 'crypto', side: 'buy' as const, notional_usd: 100 }

    // First call: no existing intent → submits.
    const first = await executeIdempotent(adapter, params, {
      supabase: makeSupabase([]), userId: 'u1', opportunityId: 'opp-42',
      retry: { sleep: () => Promise.resolve() },
    })
    expect(first.status).toBe('open')
    expect(execute).toHaveBeenCalledTimes(1)

    // Second call: intent already submitted → NO new broker call.
    const second = await executeIdempotent(adapter, params, {
      supabase: makeSupabase([{ status: 'submitted', broker_order_id: 'ord-9', broker: 'coinbase' }]),
      userId: 'u1', opportunityId: 'opp-42',
      retry: { sleep: () => Promise.resolve() },
    })
    expect(second.status).toBe('submitted')
    expect(second.broker_order_id).toBe('ord-9')
    expect(execute).toHaveBeenCalledTimes(1)  // unchanged
  })

  it('passes the SAME deterministic client_order_id on every retry', async () => {
    const seen: (string | undefined)[] = []
    let calls = 0
    const adapter = fakeAdapter(async () => {
      calls++
      return calls < 3
        ? { status: 'failed', error: 'network' }
        : { status: 'open', broker_order_id: 'ord-1' }
    })
    const origExecute = adapter.execute.bind(adapter)
    adapter.execute = async (p) => { seen.push(p.client_order_id); return origExecute(p) }

    await executeIdempotent(adapter, { symbol: 'BTC', asset_class: 'crypto', side: 'buy' }, {
      supabase: makeSupabase([]), userId: 'u1', opportunityId: 'opp-7',
      retry: { sleep: () => Promise.resolve() },
    })
    expect(seen).toHaveLength(3)
    expect(new Set(seen).size).toBe(1)
    expect(seen[0]).toBe(clientOrderId('opp-7', 'entry'))
  })
})

// ─── planReconciliation (pure OCO logic) ─────────────────────────────────────

function intent(overrides: Partial<OrderIntentRow>): OrderIntentRow {
  return {
    id: 'i1', user_id: 'u1', opportunity_id: 'opp-1',
    client_order_id: 'wos-abc', leg: 'entry', broker: 'coinbase', symbol: 'BTC',
    side: 'buy', status: 'submitted', broker_order_id: 'b-entry',
    quantity: 1, filled_quantity: null, stop_price: null, limit_price: null,
    ...overrides,
  }
}

describe('planReconciliation', () => {
  const GROUP = [
    intent({ id: 'e', leg: 'entry', broker_order_id: 'b-entry', client_order_id: 'wos-e' }),
    intent({ id: 's', leg: 'stop', side: 'sell', broker_order_id: 'b-stop', client_order_id: 'wos-s', stop_price: 90 }),
    intent({ id: 't', leg: 'take_profit', side: 'sell', broker_order_id: 'b-tp', client_order_id: 'wos-t', limit_price: 120 }),
  ]

  const statuses = (m: Record<string, BrokerOrderStatus>) => new Map(Object.entries(m))

  it('stop filled → cancels the take-profit sibling by its RECORDED id', () => {
    const actions = planReconciliation(GROUP, statuses({
      'b-stop': { status: 'filled' },
      'b-tp': { status: 'open' },
    }))
    const cancel = actions.find(a => a.type === 'cancel_sibling')
    expect(cancel).toBeDefined()
    expect(cancel!.type === 'cancel_sibling' && cancel!.intent.broker_order_id).toBe('b-tp')
  })

  it('take-profit filled → cancels the stop sibling', () => {
    const actions = planReconciliation(GROUP, statuses({
      'b-tp': { status: 'filled' },
      'b-stop': { status: 'open' },
    }))
    const cancel = actions.find(a => a.type === 'cancel_sibling')
    expect(cancel!.type === 'cancel_sibling' && cancel!.intent.broker_order_id).toBe('b-stop')
  })

  it('entry filled with a MISSING bracket leg → flags the gap (unprotected position)', () => {
    const group = [
      intent({ id: 'e', leg: 'entry', broker_order_id: 'b-entry' }),
      intent({ id: 's', leg: 'stop', broker_order_id: null, status: 'pending' }),
    ]
    const actions = planReconciliation(group, statuses({ 'b-entry': { status: 'filled' } }))
    const flag = actions.find(a => a.type === 'flag_missing_leg')
    expect(flag).toBeDefined()
    expect(flag!.type === 'flag_missing_leg' && flag!.leg).toBe('stop')
  })

  it('partial entry fill → reduces BOTH legs to the filled quantity', () => {
    const actions = planReconciliation(GROUP, statuses({
      'b-entry': { status: 'partially_filled', filledQuantity: 0.4 },
      'b-stop': { status: 'open' },
      'b-tp': { status: 'open' },
    }))
    const reduces = actions.filter(a => a.type === 'reduce_leg')
    expect(reduces).toHaveLength(2)
    expect(reduces.every(r => r.type === 'reduce_leg' && r.newQuantity === 0.4)).toBe(true)
  })

  it('entry cancelled → cancels both orphan legs', () => {
    const actions = planReconciliation(GROUP, statuses({
      'b-entry': { status: 'cancelled' },
      'b-stop': { status: 'open' },
      'b-tp': { status: 'open' },
    }))
    const cancels = actions.filter(a => a.type === 'cancel_sibling')
    expect(cancels).toHaveLength(2)
  })

  it('nothing to do while all legs are open', () => {
    const actions = planReconciliation(GROUP, statuses({
      'b-entry': { status: 'filled' },
      'b-stop': { status: 'open' },
      'b-tp': { status: 'open' },
    }))
    expect(actions.filter(a => a.type === 'cancel_sibling')).toHaveLength(0)
    expect(actions.filter(a => a.type === 'reduce_leg')).toHaveLength(0)
    expect(actions.filter(a => a.type === 'flag_missing_leg')).toHaveLength(0)
  })

  it('unknown broker status → no action (never guess)', () => {
    const actions = planReconciliation(GROUP, statuses({}))
    expect(actions).toHaveLength(0)
  })
})
