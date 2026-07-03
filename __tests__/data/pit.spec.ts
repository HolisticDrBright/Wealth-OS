/**
 * Point-in-time store (Gap brief A1): append-only, as-known-on-date, and the
 * CI invisibility guarantee — a fact ingested with as_of AFTER a backtest
 * date must be invisible to that backtest.
 */

import { describe, it, expect } from 'vitest'
import { PitStore } from '@/lib/data/pit'
import { runBacktest, type PriceBar } from '@/lib/backtester'
import { BaseStrategy, type StrategySignal } from '@/lib/strategies/base-strategy'
import type { BacktestJob } from '@/lib/types'

describe('PitStore', () => {
  it('returns the latest fact as-of the query date; the future is invisible', () => {
    const pit = new PitStore()
    pit.ingest({ entity: 'AAPL', key: 'eps_ttm', value: 6.1, asOf: '2025-01-15' })
    pit.ingest({ entity: 'AAPL', key: 'eps_ttm', value: 6.4, asOf: '2025-04-15' })
    expect(pit.getValue('AAPL', 'eps_ttm', '2025-03-01')).toBe(6.1)
    expect(pit.getValue('AAPL', 'eps_ttm', '2025-04-15')).toBe(6.4)
    expect(pit.getValue('AAPL', 'eps_ttm', '2025-01-01')).toBeNull()
  })

  it('is append-only — restating an existing (entity,key,asOf) throws', () => {
    const pit = new PitStore()
    pit.ingest({ entity: 'AAPL', key: 'eps_ttm', value: 6.1, asOf: '2025-01-15' })
    expect(() => pit.ingest({ entity: 'AAPL', key: 'eps_ttm', value: 9.9, asOf: '2025-01-15' }))
      .toThrow(/append-only/)
  })

  it('entityFacts assembles all keys visible at asOf', () => {
    const pit = new PitStore()
    pit.ingest({ entity: 'AAPL', key: 'eps_ttm', value: 6.1, asOf: '2025-01-15' })
    pit.ingest({ entity: 'AAPL', key: 'buyback', value: true, asOf: '2025-06-01' })
    expect(pit.entityFacts('AAPL', '2025-02-01')).toEqual({ eps_ttm: 6.1 })
    expect(pit.entityFacts('AAPL', '2025-07-01')).toEqual({ eps_ttm: 6.1, buyback: true })
  })
})

// ─── The CI invisibility test through the backtester ─────────────────────────

class MetaSpyStrategy extends BaseStrategy {
  readonly id = 'test_meta_spy'
  readonly displayName = 'MetaSpy'
  readonly edgeClassification = 'momentum' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'
  minBars = 2
  seen: Array<{ date: string; meta: Record<string, unknown> | undefined }> = []

  async generateSignal(_s: string, bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    this.seen.push({ date: bars[bars.length - 1].date, meta })
    return null
  }
}

function bar(i: number, close = 100): PriceBar {
  const date = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10)
  return { date, symbol: 'AAA', open: close, high: close + 1, low: close - 1, close }
}

describe('backtester PIT integration', () => {
  it('a fact ingested AFTER the backtest window never reaches the strategy', async () => {
    const pit = new PitStore()
    pit.ingest({ entity: 'AAA', key: 'known_early', value: 1, asOf: '2025-01-01' })
    pit.ingest({ entity: 'AAA', key: 'restated_later', value: 'FUTURE', asOf: '2025-06-01' })

    const spy = new MetaSpyStrategy()
    const job = {
      id: 'j', user_id: 'u', name: 't', symbols: ['AAA'], asset_class: 'stock',
      start_date: '2025-01-01', end_date: '2025-01-10', initial_capital_usd: 10_000,
      rebalance_frequency: 'daily', benchmark_symbol: 'AAA', status: 'running',
      metadata: {}, created_at: new Date().toISOString(),
    } as BacktestJob

    await runBacktest({
      job, bars: Array.from({ length: 10 }, (_, i) => bar(i)), strategy: spy, pit,
    })

    expect(spy.seen.length).toBeGreaterThan(0)
    for (const s of spy.seen) {
      expect(s.meta?.known_early, `known fact missing at ${s.date}`).toBe(1)
      expect(s.meta?.restated_later, `FUTURE fact leaked into ${s.date}`).toBeUndefined()
    }
  })
})
