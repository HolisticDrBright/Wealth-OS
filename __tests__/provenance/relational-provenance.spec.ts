/**
 * W6 — relational provenance: decision → order intent → outcome are joined
 * by real foreign keys populated at write time, and the trade tape joins
 * relationally instead of reading metadata breadcrumbs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── shared mock DB ───────────────────────────────────────────────────────────

const dbState = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  writes: [] as Array<{ table: string; op: string; row: unknown }>,
}))

function makeChain(table: string) {
  const rows = dbState.tables[table] ?? []
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'is', 'not', 'lte', 'gte', 'order', 'limit']) {
    chain[m] = () => chain
  }
  chain.single = async () => ({ data: rows[0] ?? null, error: null })
  chain.insert = (row: unknown) => {
    dbState.writes.push({ table, op: 'insert', row })
    return { ...chain, then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res) }
  }
  chain.update = (row: unknown) => {
    dbState.writes.push({ table, op: 'update', row })
    return chain
  }
  chain.upsert = (row: unknown) => {
    dbState.writes.push({ table, op: 'upsert', row })
    return { ...chain, then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res) }
  }
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve)
  return chain
}

const mockClient = { from: (table: string) => makeChain(table) }

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mockClient }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    ...mockClient,
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  }),
}))

import { executeIdempotent } from '@/lib/broker-adapters/order-intents'
import { getTradeTape } from '@/lib/actions/trade-tape'
import type { BrokerAdapter } from '@/lib/broker-adapters/types'

beforeEach(() => {
  dbState.tables = {}
  dbState.writes = []
})

describe('order_intents.decision_id populated at write', () => {
  it('executeIdempotent records the decision id on the intent row', async () => {
    const adapter = {
      config: { id: 'alpaca' },
      execute: vi.fn(async () => ({ status: 'open', broker: 'alpaca', broker_order_id: 'b1' })),
    } as unknown as BrokerAdapter

    await executeIdempotent(
      adapter,
      { symbol: 'SPY', asset_class: 'stock', side: 'buy', notional_usd: 100 },
      { supabase: mockClient as never, userId: 'u1', opportunityId: 'opp-1', decisionId: 'dec-123' }
    )

    const intentWrites = dbState.writes.filter(w => w.table === 'order_intents')
    expect(intentWrites.length).toBeGreaterThan(0)
    for (const w of intentWrites) {
      expect((w.row as { decision_id?: string }).decision_id).toBe('dec-123')
    }
  })

  it('omits decision_id when the caller has none (nullable FK)', async () => {
    const adapter = {
      config: { id: 'alpaca' },
      execute: vi.fn(async () => ({ status: 'open', broker: 'alpaca' })),
    } as unknown as BrokerAdapter

    await executeIdempotent(
      adapter,
      { symbol: 'SPY', asset_class: 'stock', side: 'buy', notional_usd: 100 },
      { supabase: mockClient as never, userId: 'u1', opportunityId: 'opp-2' }
    )

    const intentWrites = dbState.writes.filter(w => w.table === 'order_intents')
    expect(intentWrites.length).toBeGreaterThan(0)
    for (const w of intentWrites) {
      expect(w.row as Record<string, unknown>).not.toHaveProperty('decision_id')
    }
  })
})

describe('grading pass links outcome → intent and backfills intent → decision', () => {
  it('outcome_log rows carry order_intent_id; the intent gets decision_id', async () => {
    const today = new Date().toISOString()
    dbState.tables.decision_log = [
      { id: 'dec-1', confidence: 0.7, paper_position_id: 'pos-1', created_at: today },
    ]
    dbState.tables.paper_positions = [
      {
        id: 'pos-1', realized_pnl_pct: 2.5, realized_pnl_usd: 25, status: 'closed',
        metadata: { opportunityId: 'opp-1' },
      },
    ]
    dbState.tables.order_intents = [
      { id: 'intent-1', decision_id: null },
    ]
    dbState.tables.strategy_weights = [{ weights: {} }]
    dbState.tables.outcome_log = []

    const { runLearningPass } = await import('@/lib/learning/loop')
    await runLearningPass('u1')

    const outcomeInsert = dbState.writes.find(w => w.table === 'outcome_log' && w.op === 'insert')
    expect(outcomeInsert).toBeDefined()
    expect((outcomeInsert!.row as { order_intent_id?: string }).order_intent_id).toBe('intent-1')

    const intentBackfill = dbState.writes.find(
      w => w.table === 'order_intents' && w.op === 'update' && (w.row as { decision_id?: string }).decision_id === 'dec-1'
    )
    expect(intentBackfill).toBeDefined()
  })
})

describe('trade tape joins relationally', () => {
  it('fills carry decisionId + orderIntentId from real keys, not metadata', async () => {
    dbState.tables.paper_trades = [{
      id: 't1', created_at: '2026-07-03T12:00:00Z', strategy_key: 'vcp_minervini',
      symbol: 'AAPL', asset_class: 'stock', direction: 'long', side: 'open',
      fill_price: 200, notional_usd: 1000, slippage_bps: 5,
      position_id: 'pos-1', opportunity_id: 'opp-1', metadata: {},
    }]
    dbState.tables.decision_log = [
      { id: 'dec-1', paper_position_id: 'pos-1', confidence: 0.8 },
    ]
    dbState.tables.order_intents = [
      { id: 'intent-1', opportunity_id: 'opp-1', leg: 'entry' },
    ]

    const tape = await getTradeTape(10)
    expect(tape).toHaveLength(1)
    expect(tape[0].decisionId).toBe('dec-1')
    expect(tape[0].orderIntentId).toBe('intent-1')
    expect(tape[0].decisionConfidence).toBe(0.8)
  })
})
