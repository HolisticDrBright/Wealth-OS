/**
 * PaperBroker — 4 unit tests
 *
 * 1. fill() returns null when price feed returns null
 * 2. fill() applies long slippage correctly (buy at ask = mid + slip)
 * 3. fill() applies short slippage correctly (sell at bid = mid - slip)
 * 4. checkAndExitPositions() closes a position that has hit stop_loss
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

function makeSupabase(positionId = 'pos-1'): SupabaseClient {
  return {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: positionId }, error: null }),
        }),
        // for paper_trades insert (no .select)
        then: vi.fn().mockResolvedValue({ error: null }),
      }),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    }),
  } as unknown as SupabaseClient
}

describe('PaperBroker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('fill() returns null when price feed returns null', async () => {
    mockFetchCurrentPrice.mockResolvedValue(null)
    const { PaperBroker } = await import('@/lib/paper-trading/PaperBroker')
    const broker = new PaperBroker()
    const result = await broker.fill(makeOpp(), makeSize(), 'user-1', makeSupabase())
    expect(result).toBeNull()
  })

  it('fill() buys at mid + slippage for long positions (crypto = 5 bps)', async () => {
    const midPrice = 50_000
    mockFetchCurrentPrice.mockResolvedValue(midPrice)

    // Capture what fill_price was passed to insert
    let capturedFillPrice: number | undefined
    const supabase = {
      from: vi.fn().mockImplementation((table: string) => ({
        insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
          if (table === 'paper_positions') capturedFillPrice = row.entry_price as number
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'pos-1' }, error: null }),
            }),
          }
        }),
      })),
    } as unknown as SupabaseClient

    const { PaperBroker } = await import('@/lib/paper-trading/PaperBroker')
    const broker = new PaperBroker()
    const result = await broker.fill(makeOpp({ direction: 'long' }), makeSize(), 'user-1', supabase)

    expect(result).not.toBeNull()
    const expectedFillPrice = midPrice * (1 + 5 / 10_000)  // mid + 5 bps
    expect(capturedFillPrice).toBeCloseTo(expectedFillPrice, 2)
  })

  it('fill() sells at mid - slippage for short positions (crypto = 5 bps)', async () => {
    const midPrice = 50_000
    mockFetchCurrentPrice.mockResolvedValue(midPrice)

    let capturedFillPrice: number | undefined
    const supabase = {
      from: vi.fn().mockImplementation((table: string) => ({
        insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
          if (table === 'paper_positions') capturedFillPrice = row.entry_price as number
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'pos-1' }, error: null }),
            }),
          }
        }),
      })),
    } as unknown as SupabaseClient

    const { PaperBroker } = await import('@/lib/paper-trading/PaperBroker')
    const broker = new PaperBroker()
    await broker.fill(makeOpp({ direction: 'short' }), makeSize(), 'user-1', supabase)

    const expectedFillPrice = midPrice * (1 - 5 / 10_000)  // mid - 5 bps
    expect(capturedFillPrice).toBeCloseTo(expectedFillPrice, 2)
  })

  it('checkAndExitPositions() closes a position at stop_loss and writes close trade', async () => {
    // Position entered at $50,000; current price $48,900 → -2.2% → triggers 2% stop
    const entryPrice   = 50_000
    const currentPrice = 48_900
    mockFetchCurrentPrice.mockResolvedValue(currentPrice)

    const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
    const insertCalls: unknown[] = []

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        // Returns open positions list
        then: undefined,
        // Vitest will call this as a thenable — just return the positions array
        [Symbol.iterator]: undefined,
      }),
      auth: {},
    } as unknown as SupabaseClient

    // Override from() to return positions for SELECT and capture updates
    let callCount = 0
    ;(supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === 'paper_positions') {
        callCount++
        if (callCount === 1) {
          // First call: SELECT open positions
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            // Make the whole chain resolve to our test position
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
