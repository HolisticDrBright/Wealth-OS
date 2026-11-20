/**
 * Audit residue 1 regression — /api/execute-copy-trades was the last ungated
 * path to adapter.execute(). It now runs preExecutionGuard (kill switch +
 * cost gate) per trade, and the adapter's own FINAL gate refuses paper-phase
 * submissions — with the result recorded honestly ('pending', never 'open').
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const dbState = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  writes: [] as Array<{ table: string; op: string; row: Record<string, unknown> }>,
}))

function makeChain(table: string) {
  const rows = dbState.tables[table] ?? []
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit', 'is', 'not']) {
    chain[m] = () => chain
  }
  chain.single = async () => ({ data: rows[0] ?? null, error: null })
  chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null })
  chain.insert = (row: Record<string, unknown> | Array<Record<string, unknown>>) => {
    const first = Array.isArray(row) ? row[0] : row
    dbState.writes.push({ table, op: 'insert', row: first })
    const inserted = { id: `${table}-1`, ...first }
    return {
      ...chain,
      select: () => ({
        ...chain,
        single: async () => ({ data: inserted, error: null }),
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

vi.mock('@/lib/workers/auto-simulate', () => ({
  runAutoSimulate: vi.fn(async () => {}),
}))

import { POST } from '@/app/api/execute-copy-trades/route'

function request(): NextRequest {
  return new NextRequest('http://localhost/api/execute-copy-trades', {
    method: 'POST',
    headers: { authorization: 'Bearer cron-secret' },
  })
}

beforeEach(() => {
  dbState.writes = []
  dbState.tables = {
    user_followed_traders: [{
      trader_id: 't1', user_id: 'u1', auto_copy_enabled: true,
      max_allocation_pct_per_trade: 5, copy_asset_classes: ['stock'],
      traders: { id: 't1', asset_class: 'stock' },
    }],
    trader_trades: [{
      id: 'tt1', symbol: 'AAPL', asset_class: 'stock', action: 'buy',
      notional_value: 10_000, trade_date: new Date().toISOString(),
    }],
    autopilot_rules: [],
    user_copied_positions: [],
    traders: [{ id: 't1', name: 'T', handle: 't', total_return_pct: 10, win_rate_pct: 60 }],
    user_settings: [],
    user_strategy_broker_overrides: [],
    // Funded three-tier ladder: $100/mo essentials → $600 Tier 1 target, held
    // in cash; Explore cap = 10% of the $10,400 outside Safety = $1,040, so the
    // $500 copy reaches the adapter path this suite is about.
    assets: [{ category: 'stock', current_value: 10_000 }, { category: 'cash', current_value: 1_000 }],
    financial_profile: [{ monthly_essential_expenses_usd: 100 }],
  }
  vi.stubEnv('CRON_SECRET', 'cron-secret')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
  vi.stubEnv('ANTHROPIC_API_KEY', 'your-anthropic-api-key-here')  // CIO analyze skipped
  vi.stubEnv('ALPACA_API_KEY', 'fake')
  vi.stubEnv('ALPACA_SECRET_KEY', 'fake')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('POST /api/execute-copy-trades', () => {
  it('paper phase: no broker HTTP, position stays pending, response reports the skip', async () => {
    const fetchSpy = vi.fn(async () => { throw new Error('broker HTTP attempted — gate failed') })
    vi.stubGlobal('fetch', fetchSpy)

    const res = await POST(request())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(body.executed).toBe(0)
    expect(Array.isArray(body.skipped_orders)).toBe(true)
    expect(String(body.skipped_orders[0])).toContain('no order placed')

    // Position recorded honestly: pending with the skip reason, never 'open'.
    const posUpdate = dbState.writes.find(w => w.table === 'user_copied_positions' && w.op === 'update')
    expect(posUpdate?.row.status).toBe('pending')
    expect(String(posUpdate?.row.error_message)).toContain('live trading disabled')
  })

  it('kill switch active: trade blocked by preExecutionGuard before any adapter code', async () => {
    dbState.tables.system_flags = [{ user_id: null, enabled: true, reason: 'ops halt' }]
    const fetchSpy = vi.fn(async () => { throw new Error('broker HTTP attempted') })
    vi.stubGlobal('fetch', fetchSpy)

    const res = await POST(request())
    const body = await res.json()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(body.executed).toBe(0)
    expect(body.errors.some((e: string) => e.includes('blocked') && e.includes('trading_halted'))).toBe(true)
    const posUpdate = dbState.writes.find(w => w.table === 'user_copied_positions' && w.op === 'update')
    expect(posUpdate?.row.status).toBe('failed')
  })

  it('denies without the cron secret', async () => {
    const res = await POST(new NextRequest('http://localhost/api/execute-copy-trades', { method: 'POST' }))
    expect(res.status).toBe(401)
  })

  it('Tier 1 not funded: the copy is blocked before any broker call, with the plain reason', async () => {
    dbState.tables.assets = [{ category: 'stock', current_value: 10_000 }]   // no cash
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { POST } = await import('@/app/api/execute-copy-trades/route')
    const res = await POST(new NextRequest('http://localhost/api/execute-copy-trades', {
      method: 'POST', headers: { authorization: 'Bearer cron-secret' },
    }))
    const body = await res.json()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(body.executed).toBe(0)
    expect(String(body.errors?.[0])).toContain('tier1_unfunded')
    const audit = dbState.writes.find(w => w.table === 'audit_logs')
    expect((audit?.row.metadata as { blocked_by?: string })?.blocked_by).toBe('tier1_gate')
  })
})
