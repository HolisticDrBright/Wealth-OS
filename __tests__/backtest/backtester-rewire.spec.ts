/**
 * Backtester rewire — the engine now tests the ACTUAL strategy under test.
 *
 * Old engine (proven wrong here): ran one hardcoded 20-day momentum system
 * regardless of strategy_id; sliced symbol bars by an index into the UNION of
 * all dates (leaking future bars for symbols missing early dates); filled at
 * the same close that generated the signal.
 */

import { describe, it, expect } from 'vitest'
import {
  runBacktest,
  assertNoLookahead,
  LookaheadError,
  type PriceBar,
} from '@/lib/backtester'
import { runWalkForward, gridCombinations } from '@/lib/backtester-advanced'
import { BaseStrategy, type StrategySignal } from '@/lib/strategies/base-strategy'
import type { BacktestJob } from '@/lib/types'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function isoDate(i: number): string {
  const d = new Date(Date.UTC(2025, 0, 1 + i))
  return d.toISOString().slice(0, 10)
}

function bar(symbol: string, i: number, close: number, open = close): PriceBar {
  return { date: isoDate(i), symbol, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 1000 }
}

function makeJob(overrides: Partial<BacktestJob> = {}): BacktestJob {
  return {
    id: 'job-1', user_id: 'u1', name: 't', symbols: ['AAA'],
    asset_class: 'stock', start_date: isoDate(0), end_date: isoDate(400),
    initial_capital_usd: 100_000, rebalance_frequency: 'daily',
    benchmark_symbol: 'AAA', status: 'running', metadata: {},
    created_at: new Date().toISOString(),
    ...overrides,
  } as BacktestJob
}

/** Test strategy: buy when the LAST bar's close rose vs the previous close. */
class LastBarUpStrategy extends BaseStrategy {
  readonly id = 'test_last_bar_up'
  readonly displayName = 'Test'
  readonly edgeClassification = 'momentum' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'
  minBars = 2

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < 2) return null
    const last = bars[bars.length - 1].close
    const prev = bars[bars.length - 2].close
    if (last > prev) return { strategyId: this.id, symbol, side: 'buy', strength: 0.8, expectedReturn: 0.05, assetClass: 'stock' }
    if (last < prev) return { strategyId: this.id, symbol, side: 'sell', strength: 0.8, expectedReturn: 0.05, assetClass: 'stock' }
    return null
  }
}

/** Records every (asOf date, max history date) pair the engine hands it. */
class SpyStrategy extends BaseStrategy {
  readonly id = 'test_spy'
  readonly displayName = 'Spy'
  readonly edgeClassification = 'momentum' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'
  minBars = 2
  seen: Array<{ symbol: string; lastHistoryDate: string }> = []

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    this.seen.push({ symbol, lastHistoryDate: bars[bars.length - 1]?.date ?? '' })
    return null
  }
}

// ─── 1. The strategy under test actually runs ────────────────────────────────

describe('runBacktest calls the registered strategy', () => {
  it('unknown strategy_id → explicit error, no silent momentum fallback', async () => {
    const bars = [bar('AAA', 0, 100), bar('AAA', 1, 101)]
    const out = await runBacktest({ job: makeJob({ strategy_id: 'no_such_strategy' }), bars })
    expect(out.error).toContain('Unknown strategy_id')
    expect(out.result.total_trades).toBe(0)
  })

  it('a strategy override drives the trades — known signal/fill sequence by construction', async () => {
    // Flat 100 for 3 bars, close jumps to 110 on day 3 → LastBarUpStrategy
    // signals BUY on day 3 → fill must be at day 4's OPEN.
    const bars = [
      bar('AAA', 0, 100), bar('AAA', 1, 100), bar('AAA', 2, 100),
      bar('AAA', 3, 110, 100),          // signal bar (close 110 > 100)
      bar('AAA', 4, 112, 111),          // fill bar — open 111
      bar('AAA', 5, 112),
    ]
    const out = await runBacktest({
      job: makeJob(), bars, oneWayCostBps: 100, strategy: new LastBarUpStrategy(),
    })
    const buys = out.result.trade_log.filter(t => t.action === 'buy')
    expect(buys.length).toBeGreaterThan(0)
    expect(buys[0].date).toBe(isoDate(4))                    // NEXT bar, not the signal bar
    expect(buys[0].price).toBeCloseTo(111 * 1.01, 8)         // next bar's OPEN + 100bps cost
  })

  it('sell signals exit at the following bar open', async () => {
    const bars = [
      bar('AAA', 0, 100), bar('AAA', 1, 100), bar('AAA', 2, 100),
      bar('AAA', 3, 110, 100),   // buy signal
      bar('AAA', 4, 112, 111),   // buy fill at open 111; close 112 > 110 → still long
      bar('AAA', 5, 100, 112),   // close 100 < 112 → sell signal
      bar('AAA', 6, 99, 101),    // sell fill at open 101
      bar('AAA', 7, 99),
    ]
    const out = await runBacktest({
      job: makeJob(), bars, oneWayCostBps: 0, strategy: new LastBarUpStrategy(),
    })
    const sells = out.result.trade_log.filter(t => t.action === 'sell')
    expect(sells.length).toBe(1)
    expect(sells[0].date).toBe(isoDate(6))
    expect(sells[0].price).toBeCloseTo(101, 8)
  })
})

// ─── 2. Lookahead protection ─────────────────────────────────────────────────

describe('lookahead protection', () => {
  it('assertNoLookahead throws on a future bar in the array', () => {
    const history = [bar('AAA', 0, 100), bar('AAA', 5, 100)]
    expect(() => assertNoLookahead(history, isoDate(2))).toThrow(LookaheadError)
    expect(() => assertNoLookahead(history, isoDate(5))).not.toThrow()
  })

  it('symbols with MISSING EARLY DATES never receive future bars (the union-date bug)', async () => {
    // AAA trades every day; BBB starts 10 days late. The old index-based
    // slice used the union-date index, so BBB's slice(0, di+1) reached bars
    // BBB hadn't printed yet.
    const bars: PriceBar[] = []
    for (let i = 0; i < 30; i++) bars.push(bar('AAA', i, 100 + i))
    for (let i = 10; i < 30; i++) bars.push(bar('BBB', i, 50 + i))

    const spy = new SpyStrategy()
    await runBacktest({
      job: makeJob({ symbols: ['AAA', 'BBB'] }), bars, strategy: spy,
    })

    expect(spy.seen.length).toBeGreaterThan(0)
    // Every history slice the strategy saw ends at or before the decision date —
    // runBacktest's internal assertNoLookahead would have thrown otherwise.
    for (const s of spy.seen) {
      expect(s.lastHistoryDate <= isoDate(29)).toBe(true)
    }
    // BBB was evaluated (has ≥ minBars bars eventually) without ever throwing.
    expect(spy.seen.some(s => s.symbol === 'BBB')).toBe(true)
  })

  it('bars arriving UNSORTED are sorted per symbol before the strategy sees them', async () => {
    const shuffled = [
      bar('AAA', 3, 110, 100), bar('AAA', 0, 100), bar('AAA', 4, 112, 111),
      bar('AAA', 1, 100), bar('AAA', 5, 112), bar('AAA', 2, 100),
    ]
    const out = await runBacktest({
      job: makeJob(), bars: shuffled, oneWayCostBps: 0, strategy: new LastBarUpStrategy(),
    })
    const buys = out.result.trade_log.filter(t => t.action === 'buy')
    expect(buys.length).toBeGreaterThan(0)
    expect(buys[0].date).toBe(isoDate(4))  // same result as the sorted fixture
  })
})

// ─── 3. A lookahead-only edge earns ~nothing after the fix ───────────────────

describe('same-close fills are gone', () => {
  it('an alternating series is no longer profitable for a momentum-chaser', async () => {
    // Closes alternate 100 → 110 → 100 → 110… A same-close-fill engine buys
    // AT 110 the moment it sees the up-move and sells AT 110 too (fills at
    // the signal close), pocketing the alternation. With next-bar-open fills
    // the chaser buys the open AFTER the up close — right before the drop.
    const bars: PriceBar[] = []
    for (let i = 0; i < 60; i++) {
      const close = i % 2 === 0 ? 100 : 110
      const open = i % 2 === 0 ? 109 : 101  // gaps toward the coming close
      bars.push(bar('AAA', i, close, i === 0 ? 100 : open))
    }
    const out = await runBacktest({
      job: makeJob(), bars, oneWayCostBps: 0, strategy: new LastBarUpStrategy(),
    })
    // No positive expectancy: final value must not exceed the start.
    expect(out.result.final_portfolio_value_usd).toBeLessThanOrEqual(100_000)
    expect(out.result.total_trades).toBeGreaterThan(2)  // it DID trade — and earned nothing
  })
})

// ─── 4. Walk-forward parameter fitting ───────────────────────────────────────

describe('walk-forward', () => {
  it('gridCombinations expands the cartesian product with a cap', () => {
    expect(gridCombinations({ a: [1, 2], b: [3, 4] })).toHaveLength(4)
    expect(gridCombinations({ a: [1, 2, 3, 4, 5, 6], b: [1, 2, 3, 4, 5, 6] }, 10)).toHaveLength(10)
  })

  it('fits parameters per train window when the strategy exposes a grid', async () => {
    // 'momentum' (default) exposes lookback [10, 20, 40].
    const bars: PriceBar[] = []
    for (let i = 0; i < 160; i++) {
      const trend = 100 * Math.exp(0.002 * i) * (1 + 0.03 * Math.sin(i / 9))
      bars.push(bar('AAA', i, Math.round(trend * 100) / 100, Math.round(trend * 100) / 100))
    }
    const wf = await runWalkForward({
      job: makeJob({ rebalance_frequency: 'weekly' }), bars, trainDays: 80, testDays: 30,
    })
    expect(wf.parametersFitted).toBe(true)
    expect(wf.windows.length).toBeGreaterThan(0)
    for (const w of wf.windows) {
      expect(w.chosenParams).not.toBeNull()
      expect([10, 20, 40]).toContain(w.chosenParams!.lookback)
    }
  })

  it('degrades to plain out-of-sample splits for strategies with no grid', async () => {
    const bars: PriceBar[] = []
    for (let i = 0; i < 160; i++) bars.push(bar('AAA', i, 100 + i * 0.1, 100 + i * 0.1))
    const wf = await runWalkForward({
      job: makeJob({ rebalance_frequency: 'weekly' }), bars,
      trainDays: 80, testDays: 30,
      strategy: new LastBarUpStrategy(),  // paramGrid() → null
    })
    expect(wf.parametersFitted).toBe(false)
    for (const w of wf.windows) expect(w.chosenParams).toBeNull()
  })
})
