/**
 * Item 1/2 regressions — the manual API routes (orders, rebalance) now go
 * through lib/broker-adapters/router (the ONLY router):
 *
 *  - paper phase (LIVE_TRADING_ENABLED unset): no broker adapter is ever
 *    called, and the order is persisted as 'skipped' — never 'submitted'
 *  - even with LIVE_TRADING_ENABLED=true and API keys present, routes still
 *    block because no adapter is liveReady
 *  - the API response says explicitly that no broker order was placed
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { AlpacaAdapter } from '@/lib/broker-adapters/adapters'

// ─── Mock auth + DB ───────────────────────────────────────────────────────────

const dbState = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  writes: [] as Array<{ table: string; op: string; row: Record<string, unknown> }>,
}))

function makeChain(table: string) {
  const rows = dbState.tables[table] ?? []
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit', 'is', 'not', 'delete']) {
    chain[m] = () => chain
  }
  chain.single = async () => ({ data: rows[0] ?? null, error: null })
  chain.insert = (row: Record<string, unknown> | Array<Record<string, unknown>>) => {
    const first = Array.isArray(row) ? row[0] : row
    dbState.writes.push({ table, op: 'insert', row: first })
    const inserted = { id: `${table}-1`, ...first }
    return {
      ...chain,
      select: () => ({
        ...chain,
        single: async () => ({ data: inserted, error: null }),
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: Array.isArray(row) ? row : [inserted], error: null }).then(res),
      }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res),
    }
  }
  chain.update = (row: Record<string, unknown>) => {
    dbState.writes.push({ table, op: 'update', row })
    return {
      ...chain,
      eq: () => ({
        ...chain,
        select: () => ({
          single: async () => ({ data: { id: `${table}-1`, ...row }, error: null }),
        }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res),
      }),
    }
  }
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve)
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (t: string) => makeChain(t) }),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (t: string) => makeChain(t),
  }),
}))

import { POST as postOrder } from '@/app/api/orders/route'
import { POST as postRebalance } from '@/app/api/rebalance/route'

function orderRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/orders', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  dbState.tables = {}
  dbState.writes = []
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('POST /api/orders — cannot reach broker adapters', () => {
  it('paper phase: order persists as skipped, adapter never called, response says no order placed', async () => {
    const executeSpy = vi.spyOn(AlpacaAdapter.prototype, 'execute')

    const res = await postOrder(orderRequest({
      symbol: 'SPY', asset_class: 'stock', side: 'buy', notional_usd: 100,
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(executeSpy).not.toHaveBeenCalled()
    expect(body.data.status).toBe('skipped')
    expect(body.meta.broker_order_placed).toBe(false)
    expect(body.meta.message).toContain('No broker order was placed')

    // The persisted update row stored 'skipped', not 'submitted'.
    const update = dbState.writes.find(w => w.table === 'orders' && w.op === 'update')
    expect(update?.row.status).toBe('skipped')
    expect(update?.row.submitted_at).toBeNull()
  })

  it('LIVE_TRADING_ENABLED=true + API keys: still blocked — no adapter is liveReady', async () => {
    vi.stubEnv('LIVE_TRADING_ENABLED', 'true')
    vi.stubEnv('ALPACA_API_KEY', 'fake')
    vi.stubEnv('ALPACA_SECRET_KEY', 'fake')
    const executeSpy = vi.spyOn(AlpacaAdapter.prototype, 'execute')

    const res = await postOrder(orderRequest({
      symbol: 'SPY', asset_class: 'stock', side: 'buy', notional_usd: 100,
    }))
    const body = await res.json()

    expect(executeSpy).not.toHaveBeenCalled()
    expect(body.data.status).toBe('skipped')
    expect(body.data.error_message).toContain('broker_not_live_ready')
    expect(body.meta.broker_order_placed).toBe(false)
  })

  it('kill switch active: 423 with an audit row, adapter never called', async () => {
    dbState.tables.system_flags = [{ user_id: null, enabled: true, reason: 'ops halt' }]
    const executeSpy = vi.spyOn(AlpacaAdapter.prototype, 'execute')

    const res = await postOrder(orderRequest({
      symbol: 'SPY', asset_class: 'stock', side: 'buy', notional_usd: 100,
    }))

    expect(res.status).toBe(423)
    expect(executeSpy).not.toHaveBeenCalled()
    const audit = dbState.writes.find(w => w.table === 'audit_logs')
    expect((audit?.row.metadata as { blocked_by?: string })?.blocked_by).toBe('pre_execution_guard')
  })
})

describe('POST /api/rebalance — cannot reach broker adapters', () => {
  it('execute=true in paper phase: skipped orders are reported, adapter never called', async () => {
    // 100% stock portfolio vs default targets → at least one rebalance trade.
    dbState.tables.assets = [
      { id: 'a1', user_id: 'user-1', category: 'stock', current_value: 100_000 },
    ]
    dbState.tables.portfolio_targets = []
    const executeSpy = vi.spyOn(AlpacaAdapter.prototype, 'execute')

    const req = new NextRequest('http://localhost/api/rebalance', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ execute: true }),
    })
    const res = await postRebalance(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(executeSpy).not.toHaveBeenCalled()
    expect(body.data.executed).toBe(0)
    expect(Array.isArray(body.data.skipped_orders)).toBe(true)
    expect(body.data.skipped_orders.length).toBeGreaterThan(0)
    expect(String(body.data.skipped_orders[0])).toContain('no order placed')
  })
})
