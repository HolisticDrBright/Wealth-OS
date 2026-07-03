/**
 * Pure in-process backtesting engine — tests the ACTUAL strategy under test.
 *
 * runBacktest resolves job.strategy_id in the legacy strategy registry and
 * calls that strategy's generateSignal() per bar step. (The old engine ran
 * one hardcoded 20-day momentum system regardless of strategy_id, so every
 * "backtest" validated the same rule.)
 *
 * Honesty guarantees:
 *   - Bars are sorted by date PER SYMBOL and history is truncated by DATE,
 *     never by an index into the union of all dates (the old index slice
 *     leaked future bars for any symbol missing early dates).
 *   - assertNoLookahead() throws if a bar with date > asOf ever reaches a
 *     strategy.
 *   - Signals decided on bar t fill at bar t+1's OPEN (never the same close
 *     that produced the signal), with per-venue costs from
 *     lib/costs/transaction-costs.ts applied to every fill.
 */
import type { BacktestJob, BacktestResult, BacktestTrade } from './types'
import type { BaseStrategy, StrategySignal } from './strategies/base-strategy'

export interface PriceBar {
  date: string        // YYYY-MM-DD
  symbol: string
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export interface BacktestConfig {
  job: BacktestJob
  bars: PriceBar[]   // caller supplies historical bars
  /**
   * One-way transaction cost in bps of notional (fee + half-spread), charged
   * on every fill. Defaults to the stocks model (4 bps). Pass the value from
   * lib/costs/transaction-costs.ts oneWayCostBps() for other asset classes.
   * Zero-cost backtests systematically overstate high-turnover strategies.
   */
  oneWayCostBps?: number
  /**
   * Strategy instance override — used by walk-forward parameter search and
   * tests. When omitted, job.strategy_id is resolved in the registry
   * ('momentum' when unset).
   */
  strategy?: BaseStrategy
}

export interface BacktestOutput {
  result: Omit<BacktestResult, 'id' | 'created_at'>
  error?: string
}

interface Position {
  symbol: string
  quantity: number
  avg_cost: number
}

// ─── Statistics helpers ───────────────────────────────────

function annualize(totalReturnPct: number, days: number): number {
  if (days <= 0) return 0
  return (Math.pow(1 + totalReturnPct / 100, 365 / days) - 1) * 100
}

function computeSharpe(returns: number[], riskFreeAnnual = 0.05): number {
  if (returns.length < 2) return 0
  const rf = riskFreeAnnual / 252
  const excess = returns.map(r => r - rf)
  const mean = excess.reduce((s, r) => s + r, 0) / excess.length
  const variance = excess.reduce((s, r) => s + (r - mean) ** 2, 0) / (excess.length - 1)
  const std = Math.sqrt(variance)
  return std > 0 ? (mean / std) * Math.sqrt(252) : 0
}

function computeSortino(returns: number[], riskFreeAnnual = 0.05): number {
  if (returns.length < 2) return 0
  const rf = riskFreeAnnual / 252
  const excess = returns.map(r => r - rf)
  const mean = excess.reduce((s, r) => s + r, 0) / excess.length
  const downside = excess.filter(r => r < 0)
  if (downside.length === 0) return mean > 0 ? 10 : 0
  const dVariance = downside.reduce((s, r) => s + r ** 2, 0) / downside.length
  const dStd = Math.sqrt(dVariance)
  return dStd > 0 ? (mean / dStd) * Math.sqrt(252) : 0
}

function computeMaxDrawdown(equity: number[]): { pct: number; durationDays: number } {
  let peak = equity[0]
  let maxDD = 0
  let ddStart = 0
  let maxDuration = 0
  let troughIdx = 0

  for (let i = 1; i < equity.length; i++) {
    if (equity[i] > peak) {
      peak = equity[i]
      ddStart = i
    }
    const dd = (peak - equity[i]) / peak
    if (dd > maxDD) {
      maxDD = dd
      troughIdx = i
      maxDuration = troughIdx - ddStart
    }
  }
  return { pct: maxDD * 100, durationDays: maxDuration }
}

function computeMonthlyReturns(equity: Array<{ date: string; value: number }>): Record<string, number> {
  const monthly: Record<string, number> = {}
  const byMonth: Record<string, number[]> = {}

  for (const e of equity) {
    const month = e.date.slice(0, 7) // YYYY-MM
    if (!byMonth[month]) byMonth[month] = []
    byMonth[month].push(e.value)
  }

  const months = Object.keys(byMonth).sort()
  for (let i = 1; i < months.length; i++) {
    const prev = byMonth[months[i - 1]]
    const curr = byMonth[months[i]]
    const prevClose = prev[prev.length - 1]
    const currClose = curr[curr.length - 1]
    monthly[months[i]] = ((currClose - prevClose) / prevClose) * 100
  }

  return monthly
}

// ─── Lookahead guard ─────────────────────────────────────

export class LookaheadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LookaheadError'
  }
}

/** Throws when any bar postdates asOf — no future bar may reach a strategy. */
export function assertNoLookahead(bars: PriceBar[], asOfDate: string): void {
  for (const b of bars) {
    if (b.date > asOfDate) {
      throw new LookaheadError(
        `lookahead: bar ${b.symbol}@${b.date} leaked into a decision as of ${asOfDate}`
      )
    }
  }
}

// ─── Strategy resolution ─────────────────────────────────

async function resolveStrategy(job: BacktestJob, override?: BaseStrategy): Promise<BaseStrategy | null> {
  if (override) return override
  const strategyId = job.strategy_id ?? 'momentum'
  // Dynamic import: all-strategies type-imports PriceBar from this module.
  const { STRATEGY_REGISTRY } = await import('./strategies/all-strategies')
  return STRATEGY_REGISTRY.get(strategyId) ?? null
}

// ─── Main backtester ─────────────────────────────────────

interface PendingOrder {
  symbol: string
  action: 'buy' | 'sell'
  /** Buy: notional to deploy at the fill. Sell: quantity to close. */
  notionalUsd?: number
  quantity?: number
}

export async function runBacktest(config: BacktestConfig): Promise<BacktestOutput> {
  const { job, bars } = config
  // Buys fill above the reference price, sells below — each side pays fee + half-spread.
  const costFrac = (config.oneWayCostBps ?? 4) / 10_000

  if (!bars.length) {
    return { result: emptyResult(job), error: 'No price data provided' }
  }

  const strategy = await resolveStrategy(job, config.strategy)
  if (!strategy) {
    return { result: emptyResult(job), error: `Unknown strategy_id: ${job.strategy_id}` }
  }

  const symbols = job.symbols
  const capital = job.initial_capital_usd
  let cash = capital
  const positions: Map<string, Position> = new Map()
  const trades: BacktestTrade[] = []
  const equity: Array<{ date: string; value: number; benchmark?: number }> = []
  const dailyReturns: number[] = []

  // ── Data hygiene: per-symbol bars SORTED BY DATE ───────────────────────────
  const barsBySymbol = new Map<string, PriceBar[]>()
  for (const bar of bars) {
    if (!barsBySymbol.has(bar.symbol)) barsBySymbol.set(bar.symbol, [])
    barsBySymbol.get(bar.symbol)!.push(bar)
  }
  for (const arr of barsBySymbol.values()) {
    arr.sort((a, b) => a.date.localeCompare(b.date))
  }

  const allDates = [...new Set(bars.map(b => b.date))].sort()
  const barsByDateSym: Map<string, Map<string, PriceBar>> = new Map()
  for (const bar of bars) {
    if (!barsByDateSym.has(bar.date)) barsByDateSym.set(bar.date, new Map())
    barsByDateSym.get(bar.date)?.set(bar.symbol, bar)
  }

  // Advancing per-symbol pointers: history is truncated by DATE, never by an
  // index into the union of all dates.
  const ptr = new Map<string, number>()
  for (const sym of barsBySymbol.keys()) ptr.set(sym, -1)
  function historyUpTo(sym: string, date: string): PriceBar[] {
    const arr = barsBySymbol.get(sym) ?? []
    let i = ptr.get(sym) ?? -1
    while (i + 1 < arr.length && arr[i + 1].date <= date) i++
    ptr.set(sym, i)
    return arr.slice(0, i + 1)
  }

  // Benchmark
  const benchmarkSymbol = job.benchmark_symbol ?? 'SPY'
  const benchmarkBars = barsBySymbol.get(benchmarkSymbol) ?? []
  const benchmarkStart = benchmarkBars[0]?.close ?? 100
  const benchmarkMap: Map<string, number> = new Map(benchmarkBars.map(b => [b.date, b.close]))

  let prevEquity = capital
  const pending: PendingOrder[] = []
  const minBars = Math.max(2, strategy.minBars ?? 20)

  for (let di = 0; di < allDates.length; di++) {
    const date = allDates[di]
    const dayBars: Map<string, PriceBar> = barsByDateSym.get(date) ?? new Map()

    // ── 1. Execute pending orders at TODAY'S OPEN (decided on an earlier bar) ─
    if (pending.length) {
      const stillPending: PendingOrder[] = []
      // Sells first — they free the cash the buys need.
      pending.sort((a, b) => (a.action === 'sell' ? -1 : 1) - (b.action === 'sell' ? -1 : 1))
      for (const order of pending) {
        const bar = dayBars.get(order.symbol)
        if (!bar) { stillPending.push(order); continue }  // symbol has no bar today — fill at its next bar

        if (order.action === 'sell') {
          const pos = positions.get(order.symbol)
          if (!pos || pos.quantity <= 0) continue
          const sellQty = Math.min(order.quantity ?? pos.quantity, pos.quantity)
          const fillPrice = bar.open * (1 - costFrac)
          const proceeds = sellQty * fillPrice
          const pnl = proceeds - sellQty * pos.avg_cost
          cash += proceeds
          pos.quantity -= sellQty
          if (pos.quantity < 1e-9) positions.delete(order.symbol)
          trades.push({ date, symbol: order.symbol, action: 'sell', quantity: sellQty, price: fillPrice, notional: proceeds, pnl })
        } else {
          const notional = Math.min(order.notionalUsd ?? 0, cash)
          if (notional < 50) continue
          const fillPrice = bar.open * (1 + costFrac)
          const qty = notional / fillPrice
          cash -= notional
          const existing = positions.get(order.symbol)
          if (existing) {
            const totalQty = existing.quantity + qty
            existing.avg_cost = (existing.avg_cost * existing.quantity + fillPrice * qty) / totalQty
            existing.quantity = totalQty
          } else {
            positions.set(order.symbol, { symbol: order.symbol, quantity: qty, avg_cost: fillPrice })
          }
          trades.push({ date, symbol: order.symbol, action: 'buy', quantity: qty, price: fillPrice, notional, pnl: undefined })
        }
      }
      pending.length = 0
      pending.push(...stillPending)
    }

    // ── 2. Mark portfolio to today's closes ───────────────────────────────────
    let portfolioValue = cash
    for (const [sym, pos] of positions.entries()) {
      const bar = dayBars.get(sym)
      if (bar) portfolioValue += pos.quantity * bar.close
    }

    // ── 3. Signal step: call the ACTUAL strategy per symbol ───────────────────
    const shouldRebalance =
      job.rebalance_frequency === 'daily' ||
      (job.rebalance_frequency === 'none' && di === minBars) ||   // single entry pass post-warmup
      (job.rebalance_frequency === 'weekly' && di % 5 === 0) ||
      (job.rebalance_frequency === 'monthly' && di % 21 === 0)

    if (shouldRebalance) {
      const buySignals: Array<{ sym: string; signal: StrategySignal }> = []
      const sellSymbols: string[] = []

      for (const sym of symbols) {
        if (!dayBars.has(sym)) continue
        const history = historyUpTo(sym, date)
        if (history.length < minBars) continue

        // The invariant the old engine broke: nothing after `date` may be seen.
        assertNoLookahead(history, date)

        let signal: StrategySignal | null = null
        try {
          signal = await strategy.generateSignal(sym, history, job.metadata)
        } catch (err) {
          if (err instanceof LookaheadError) throw err
          continue  // a strategy error on one symbol must not kill the run
        }
        if (!signal) continue
        if (signal.side === 'buy') buySignals.push({ sym, signal })
        else if (positions.has(sym)) sellSymbols.push(sym)
      }

      // Queue exits (fill at next bar's open)
      for (const sym of sellSymbols) {
        pending.push({ symbol: sym, action: 'sell' })
      }

      // Queue entries/rebalances to equal weight across buy signals + holds
      const holds = [...positions.keys()].filter(s => !sellSymbols.includes(s))
      const targetSymbols = new Set([...holds, ...buySignals.map(b => b.sym)])
      if (targetSymbols.size > 0) {
        const targetPerPosition = (portfolioValue * 0.95) / targetSymbols.size
        for (const { sym } of buySignals) {
          const bar = dayBars.get(sym)
          if (!bar) continue
          const existing = positions.get(sym)
          const existingValue = existing ? existing.quantity * bar.close : 0
          const diff = targetPerPosition - existingValue
          if (diff < 50) continue  // already at/above target or dust
          pending.push({ symbol: sym, action: 'buy', notionalUsd: diff })
        }
      }
    }

    // ── 4. Record equity ───────────────────────────────────────────────────────
    let finalValue = cash
    for (const [sym, pos] of positions.entries()) {
      const bar = dayBars.get(sym)
      if (bar) finalValue += pos.quantity * bar.close
    }

    const benchmarkPrice = benchmarkMap.get(date)
    const benchmarkValue = benchmarkPrice ? (benchmarkPrice / benchmarkStart) * capital : undefined

    equity.push({ date, value: Math.round(finalValue * 100) / 100, benchmark: benchmarkValue })
    if (prevEquity > 0) dailyReturns.push((finalValue - prevEquity) / prevEquity)
    prevEquity = finalValue
  }

  if (equity.length === 0) return { result: emptyResult(job), error: 'No equity data computed' }

  const startValue = equity[0].value
  const endValue = equity[equity.length - 1].value
  const totalReturnPct = ((endValue - startValue) / startValue) * 100
  const days = allDates.length
  const annualizedReturn = annualize(totalReturnPct, days)

  const benchmarkEnd = equity[equity.length - 1].benchmark ?? capital
  const benchmarkReturnPct = ((benchmarkEnd - capital) / capital) * 100

  const equityValues = equity.map(e => e.value)
  const { pct: maxDrawdownPct, durationDays: maxDrawdownDuration } = computeMaxDrawdown(equityValues)

  const winningTrades = trades.filter(t => t.action === 'sell' && (t.pnl ?? 0) > 0)
  const losingTrades = trades.filter(t => t.action === 'sell' && (t.pnl ?? 0) <= 0)
  const sellTrades = trades.filter(t => t.action === 'sell')
  const totalPnl = sellTrades.reduce((s, t) => s + (t.pnl ?? 0), 0)
  const grossProfit = winningTrades.reduce((s, t) => s + (t.pnl ?? 0), 0)
  const grossLoss = Math.abs(losingTrades.reduce((s, t) => s + (t.pnl ?? 0), 0))

  const sharpe = computeSharpe(dailyReturns)
  const sortino = computeSortino(dailyReturns)
  const alpha = annualizedReturn - benchmarkReturnPct

  // Real beta: covariance(portfolio, benchmark) / variance(benchmark)
  const benchmarkDailyReturns: number[] = []
  for (let i = 1; i < allDates.length; i++) {
    const prev = benchmarkMap.get(allDates[i - 1])
    const curr = benchmarkMap.get(allDates[i])
    if (prev && curr && prev > 0) benchmarkDailyReturns.push((curr - prev) / prev)
  }
  let beta = 1
  if (dailyReturns.length > 20 && benchmarkDailyReturns.length > 20) {
    const minLen = Math.min(dailyReturns.length, benchmarkDailyReturns.length)
    const pRets = dailyReturns.slice(-minLen)
    const bRets = benchmarkDailyReturns.slice(-minLen)
    const mb = bRets.reduce((s, v) => s + v, 0) / minLen
    const varB = bRets.reduce((s, v) => s + (v - mb) ** 2, 0) / (minLen - 1)
    if (varB > 0) {
      const mp = pRets.reduce((s, v) => s + v, 0) / minLen
      const cov = pRets.reduce((s, v, i) => s + (v - mp) * (bRets[i] - mb), 0) / (minLen - 1)
      beta = Math.max(0.05, Math.min(3, cov / varB))
    }
  }

  return {
    result: {
      job_id: job.id,
      user_id: job.user_id,
      total_return_pct: Math.round(totalReturnPct * 100) / 100,
      annualized_return_pct: Math.round(annualizedReturn * 100) / 100,
      benchmark_return_pct: Math.round(benchmarkReturnPct * 100) / 100,
      alpha: Math.round(alpha * 100) / 100,
      beta: Math.round(beta * 100) / 100,
      sharpe_ratio: Math.round(sharpe * 100) / 100,
      sortino_ratio: Math.round(sortino * 100) / 100,
      max_drawdown_pct: Math.round(maxDrawdownPct * 100) / 100,
      max_drawdown_duration_days: maxDrawdownDuration,
      win_rate_pct: sellTrades.length > 0 ? Math.round((winningTrades.length / sellTrades.length) * 10000) / 100 : 0,
      profit_factor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : grossProfit > 0 ? 99 : 0,
      total_trades: trades.length,
      winning_trades: winningTrades.length,
      losing_trades: losingTrades.length,
      avg_win_usd: winningTrades.length > 0 ? Math.round(grossProfit / winningTrades.length * 100) / 100 : 0,
      avg_loss_usd: losingTrades.length > 0 ? Math.round(grossLoss / losingTrades.length * 100) / 100 : 0,
      final_portfolio_value_usd: Math.round(endValue * 100) / 100,
      equity_curve: equity,
      monthly_returns: computeMonthlyReturns(equity),
      trade_log: trades,
    },
  }
}

function emptyResult(job: BacktestJob): Omit<BacktestResult, 'id' | 'created_at'> {
  return {
    job_id: job.id,
    user_id: job.user_id,
    total_return_pct: 0,
    annualized_return_pct: 0,
    benchmark_return_pct: 0,
    alpha: 0, beta: 1,
    sharpe_ratio: 0, sortino_ratio: 0,
    max_drawdown_pct: 0, max_drawdown_duration_days: 0,
    win_rate_pct: 0, profit_factor: 0,
    total_trades: 0, winning_trades: 0, losing_trades: 0,
    avg_win_usd: 0, avg_loss_usd: 0,
    final_portfolio_value_usd: job.initial_capital_usd,
    equity_curve: [],
    monthly_returns: {},
    trade_log: [],
  }
}

/**
 * Generate synthetic price bars for a symbol over a date range.
 * Used when no real data source is configured.
 * Produces a geometric Brownian motion walk seeded by symbol.
 */
export function generateSyntheticBars(
  symbol: string,
  startDate: string,
  endDate: string,
  startPrice = 100,
  annualDrift = 0.08,
  annualVol = 0.20
): PriceBar[] {
  const bars: PriceBar[] = []
  const dt = 1 / 252
  const drift = (annualDrift - 0.5 * annualVol ** 2) * dt
  const diffusion = annualVol * Math.sqrt(dt)

  // Simple deterministic PRNG seeded by symbol for reproducibility
  let seed = symbol.split('').reduce((s, c) => s + c.charCodeAt(0), 0)
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return (seed / 0xffffffff) * 2 - 1 // [-1, 1]
  }
  const randn = () => {
    const u = (seed = (seed * 1664525 + 1013904223) >>> 0, seed / 0xffffffff)
    const v = (seed = (seed * 1664525 + 1013904223) >>> 0, seed / 0xffffffff)
    return Math.sqrt(-2 * Math.log(Math.max(u, 1e-10))) * Math.cos(2 * Math.PI * v)
  }

  let price = startPrice
  const cursor = new Date(startDate)
  const end = new Date(endDate)

  while (cursor <= end) {
    const dow = cursor.getDay()
    if (dow !== 0 && dow !== 6) { // skip weekends
      const shock = randn()
      price = price * Math.exp(drift + diffusion * shock)
      price = Math.max(price, 0.01)
      const open = price * (1 + rand() * 0.005)
      const high = Math.max(open, price) * (1 + Math.abs(rand()) * 0.01)
      const low = Math.min(open, price) * (1 - Math.abs(rand()) * 0.01)
      bars.push({
        date: cursor.toISOString().slice(0, 10),
        symbol,
        open: Math.round(open * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        close: Math.round(price * 100) / 100,
        volume: Math.round(1e6 + Math.abs(rand()) * 5e6),
      })
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return bars
}
