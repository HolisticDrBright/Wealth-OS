/**
 * PaperBroker — unit tests
 *
 * fill() now returns PaperFillResult (discriminated union) instead of { id } | null.
 * Tests updated accordingly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Opportunity, PositionSize } from '@/lib/strategies/pipeline-types'

// Mock price-feed before importing PaperBroker
const mockFetchCurrentPrice = vi.fn<() => Promise<number | null>>()
vi.mock('@/lib/paper-trading/price-feed', () => ({
  fetchCurrentPrice: (...args: unknown[]) => mockFetchCurrentPrice(...args),
}))

function makeOpp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'opp-1',
    strategyKey: 'dca_halving',
    symbol: 'BTC',
    direction: 'long',
    assetClass: 'crypto',
    strength: 0.7,
    expectedReturn: 0.03,
    metadata: {},
    detectedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeSize(notionalUsd = 500): PositionSize {
  return { fraction: 0.05, notionalUsd, rationale: 'test' }
}

/** Supabase mock that handles the dedup count query + insert flow. */
function makeSupabase(positionId = 'pos-1'): SupabaseClient {
  const builder = {
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: positionId }, error: null }),
      }),
    }),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    then: (resolve: (v: { count: number; data: null; error: null }) => void) =>
      Promise.resolve({ count: 0, data: null, error: null }).then(resolve),
  }
  return { from: vi.fn().mockReturnValue(builder) } as unknown as SupabaseClient
}

describe('PaperBroker', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.clearAllMocks() })

  it('fill() returns missing_price when price feed returns null', async () => {
    mockFetchCurrentPrice.mockResolvedValue(null)
    const { PaperBroker } = await import('@/lib/paper-trading/PaperBroker')
    const broker = new PaperBroker()
    const result = await broker.fill(makeOpp(), makeSize(), 'user-1', makeSupabase())
    expect(result.status).toBe('missing_price')
  })

  it('fill() returns already_open when dedup check finds an open position', async () => {
    mockFetchCurrentPrice.mockResolvedValue(50_000)
    const dedupBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: (resolve: (v: { count: number }) => void) =>
        Promise.resolve({ count: 1 }).then(resolve),
    }
    const supabase = { from: vi.fn().mockReturnValue(dedupBuilder) } as unknown as SupabaseClient
    const { PaperBroker } = await import('@/lib/paper-trading/PaperBroker')
    const broker = new PaperBroker()
    const result = await broker.fill(makeOpp(), makeSize(), 'user-1', supabase)
    expect(result.status).toBe('already_open')
  })

  it('fill() returns opened and charges long slippage (crypto = 5 bps)', async () => {
    const midPrice = 50_000
    mockFetchCurrentPrice.mockResolvedValue(midPrice)

    let capturedFillPrice: number | undefined
    const thenable = (resolve: (v: unknown) => void) =>
      Promise.resolve({ error: null }).then(resolve)
    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        const builder = {
          insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
            if (table === 'paper_positions') capturedFillPrice = row.entry_price as number
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'pos-1' }, error: null }),
              }),
              then: thenable,
            }
          }),
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          then: (resolve: (v: unknown) => void) =>
            Promise.resolve({ count: 0, data: null, error: null }).then(resolve),
        }
        return builder
      }),
    } as unknown as SupabaseClient

    const { PaperBroker } = await import('@/lib/paper-trading/PaperBroker')
    const broker = new PaperBroker()
    const result = await broker.fill(makeOpp({ direction: 'long' }), makeSize(), 'user-1', supabase)

    expect(result.status).toBe('opened')
    const expectedFillPrice = midPrice * (1 + 5 / 10_000)
    expect(capturedFillPrice).toBeCloseTo(expectedFillPrice, 2)
  })

  it('fill() returns opened and charges short slippage (crypto = 5 bps)', async () => {
    const midPrice = 50_000
    mockFetchCurrentPrice.mockResolvedValue(midPrice)

    let capturedFillPrice: number | undefined
    const thenable = (resolve: (v: unknown) => void) =>
      Promise.resolve({ error: null }).then(resolve)
    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        const builder = {
          insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
            if (table === 'paper_positions') capturedFillPrice = row.entry_price as number
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'pos-1' }, error: null }),
              }),
              then: thenable,
            }
          }),
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          then: (resolve: (v: unknown) => void) =>
            Promise.resolve({ count: 0, data: null, error: null }).then(resolve),
        }
        return builder
      }),
    } as unknown as SupabaseClient

    const { PaperBroker } = await import('@/lib/paper-trading/PaperBroker')
    const broker = new PaperBroker()
    await broker.fill(makeOpp({ direction: 'short' }), makeSize(), 'user-1', supabase)

    const expectedFillPrice = midPrice * (1 - 5 / 10_000)
    expect(capturedFillPrice).toBeCloseTo(expectedFillPrice, 2)
  })

  it('fill() returns insert_error when Supabase insert fails', async () => {
    mockFetchCurrentPrice.mockResolvedValue(50_000)
    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'paper_positions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
              }),
            }),
            then: (resolve: (v: unknown) => void) =>
              Promise.resolve({ count: 0 }).then(resolve),
          }
        }
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }),
    } as unknown as SupabaseClient

    const { PaperBroker } = await import('@/lib/paper-trading/PaperBroker')
    const broker = new PaperBroker()
    const result = await broker.fill(makeOpp(), makeSize(), 'user-1', supabase)
    expect(result.status).toBe('insert_error')
  })

  it('checkAndExitPositions() closes a position at stop_loss and writes close trade', async () => {
    const entryPrice   = 50_000
    const currentPrice = 48_900  // -2.2% → triggers 2% stop
    mockFetchCurrentPrice.mockResolvedValue(currentPrice)

    const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
    const insertCalls: unknown[] = []

    const supabase = {
      from: vi.fn(),
      auth: {},
    } as unknown as SupabaseClient

    let callCount = 0
    ;(supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === 'paper_positions') {
        callCount++
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: (v: { data: unknown[] }) => void) => resolve({
              data: [{
                id: 'pos-1', user_id: 'user-1',
                strategy_key: 'dca_halving', symbol: 'BTC', asset_class: 'crypto',
                direction: 'long',
                entry_price: entryPrice, quantity: 0.01, notional_usd: 500,
                stop_loss_pct: 0.02, take_profit_pct: 0.05, max_hold_hours: 24,
                opened_at: new Date(Date.now() - 1000).toISOString(),
              }],
            }),
          }
        }
        return { update: mockUpdate }
      }
      if (table === 'paper_trades') {
        return {
          insert: vi.fn().mockImplementation((row: unknown) => {
            insertCalls.push(row)
            return Promise.resolve({ error: null })
          }),
        }
      }
      if (table === 'decision_log') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          then: (resolve: (v: unknown) => void) =>
            Promise.resolve({ data: [], error: null }).then(resolve),
        }
      }
      return { insert: vi.fn().mockResolvedValue({ error: null }) }
    })

    const { PaperBroker } = await import('@/lib/paper-trading/PaperBroker')
    const broker = new PaperBroker()
    const closed = await broker.checkAndExitPositions(supabase, 'user-1')

    expect(closed).toBe(1)
    expect(mockUpdate).toHaveBeenCalledOnce()
    const updateArg = mockUpdate.mock.calls[0][0] as Record<string, unknown>
    expect(updateArg.status).toBe('closed')
    expect(updateArg.exit_reason).toBe('stop_loss')
  })
})
