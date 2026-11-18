/**
 * Phase 1.3 — Flatten & Halt actually closes positions.
 *
 * PaperBroker.flattenAllPositions must close EVERY open paper position through
 * the same exit path as the runner (paper_positions → closed, a paper_trades
 * exit row), fall back to the last mark when the live price feed is down, and
 * report (not hide) positions it could not close. The flattenAndHalt action
 * sets the halt flag BEFORE flattening and writes an audit_logs row.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join } from 'path'

const mockFetchCurrentPrice = vi.fn<(...args: unknown[]) => Promise<number | null>>()
vi.mock('@/lib/paper-trading/price-feed', () => ({
  fetchCurrentPrice: (...args: unknown[]) => mockFetchCurrentPrice(...args),
}))
vi.mock('@/lib/alerts/auto-alerts', () => ({
  alertPositionClosed: vi.fn(),
  alertPositionOpened: vi.fn(),
}))

function openPosition(over: Record<string, unknown> = {}) {
  return {
    id: 'pos-1',
    user_id: 'user-1',
    strategy_key: 'pead',
    symbol: 'AAPL',
    asset_class: 'stocks',
    direction: 'long',
    status: 'open',
    entry_price: 100,
    current_price: 105,
    quantity: 10,
    notional_usd: 1000,
    stop_loss_pct: 0.03,
    take_profit_pct: 0.08,
    max_hold_hours: 120,
    opened_at: new Date().toISOString(),
    ...over,
  }
}

/** Records every update/insert so assertions can inspect the close writes. */
function makeSupabase(positions: Array<Record<string, unknown>>) {
  const updates: Array<{ table: string; values: Record<string, unknown>; id: unknown }> = []
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = []

  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {}
    builder.select = vi.fn().mockReturnValue(builder)
    builder.eq = vi.fn().mockReturnValue(builder)
    builder.limit = vi.fn().mockReturnValue(builder)
    builder.update = vi.fn((values: Record<string, unknown>) => ({
      eq: vi.fn((_col: string, id: unknown) => {
        updates.push({ table, values, id })
        return Promise.resolve({ error: null })
      }),
    }))
    builder.insert = vi.fn((values: Record<string, unknown>) => {
      inserts.push({ table, values })
      return Promise.resolve({ error: null })
    })
    // select resolution: paper_positions returns the open set; decision_log empty
    builder.then = (resolve: (v: unknown) => void) =>
      Promise.resolve({ data: table === 'paper_positions' ? positions : [], error: null }).then(resolve)
    return builder
  })

  return { supabase: { from } as unknown as SupabaseClient, updates, inserts }
}

describe('PaperBroker.flattenAllPositions', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('closes every open position with exit_reason manual_flatten + a paper_trades row', async () => {
    mockFetchCurrentPrice.mockResolvedValue(110)
    const { supabase, updates, inserts } = makeSupabase([
      openPosition({ id: 'pos-1', symbol: 'AAPL' }),
      openPosition({ id: 'pos-2', symbol: 'MSFT' }),
    ])
    const { PaperBroker } = await import('@/lib/paper-trading/PaperBroker')
    const res = await new PaperBroker().flattenAllPositions(supabase, 'user-1')

    expect(res.closed).toBe(2)
    expect(res.failures).toEqual([])

    const posUpdates = updates.filter(u => u.table === 'paper_positions')
    expect(posUpdates).toHaveLength(2)
    for (const u of posUpdates) {
      expect(u.values.status).toBe('closed')
      expect(u.values.exit_reason).toBe('manual_flatten')
      expect(u.values.closed_at).toBeTruthy()
      expect(typeof u.values.realized_pnl_usd).toBe('number')
    }

    const tradeRows = inserts.filter(i => i.table === 'paper_trades')
    expect(tradeRows).toHaveLength(2)
    expect(tradeRows.every(t => t.values.side === 'close')).toBe(true)
  })

  it('falls back to the last mark when the live price feed is down', async () => {
    mockFetchCurrentPrice.mockResolvedValue(null)
    const { supabase, updates } = makeSupabase([openPosition({ current_price: 105 })])
    const { PaperBroker } = await import('@/lib/paper-trading/PaperBroker')
    const res = await new PaperBroker().flattenAllPositions(supabase, 'user-1')

    expect(res.closed).toBe(1)
    const u = updates.find(x => x.table === 'paper_positions')!
    expect(u.values.status).toBe('closed')
    // Closed against the 105 mark (minus exit slippage), not skipped.
    expect(u.values.current_price).toBe(105)
  })

  it('reports a position with no price at all instead of silently skipping it', async () => {
    mockFetchCurrentPrice.mockResolvedValue(null)
    const { supabase, updates } = makeSupabase([
      openPosition({ id: 'pos-x', symbol: 'MYSTERY', current_price: null, entry_price: null }),
    ])
    const { PaperBroker } = await import('@/lib/paper-trading/PaperBroker')
    const res = await new PaperBroker().flattenAllPositions(supabase, 'user-1')

    expect(res.closed).toBe(0)
    expect(res.failures).toHaveLength(1)
    expect(res.failures[0]).toContain('MYSTERY')
    expect(updates.filter(u => u.table === 'paper_positions')).toHaveLength(0)
  })
})

describe('flattenAndHalt wiring (source contracts)', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), ...p.split('/')), 'utf8')

  it('the shared pause core halts FIRST, then flattens, then writes audit_logs', () => {
    const src = read('lib/simple/pause-core.ts')
    const haltIdx = src.indexOf('setHaltFlag(supabase, userId, true')
    const flattenIdx = src.indexOf('flattenAllPositions(')
    const auditIdx = src.indexOf("from('audit_logs')")
    expect(haltIdx).toBeGreaterThan(-1)
    expect(flattenIdx).toBeGreaterThan(haltIdx)
    expect(auditIdx).toBeGreaterThan(flattenIdx)
  })

  it('the web action delegates to the shared pause core (one implementation)', () => {
    const src = read('lib/actions/risk-strip.ts')
    expect(src).toContain('pauseTradingCore')
  })

  it('the risk strip calls flattenAndHalt (not just the flag setter) and surfaces errors', () => {
    const src = read('components/layout/risk-strip.tsx')
    expect(src).toContain('flattenAndHalt(')
    expect(src).toContain('risk data unavailable')
    expect(src).toContain('actionError')
    // Dialog text matches reality: closes now, paper only, live out of scope.
    expect(src).toContain('closed NOW at current prices')
    expect(src).toMatch(/[Ll]ive brokerage positions are out of scope/)
    expect(src).not.toContain('will be closed by the runner')
  })
})
