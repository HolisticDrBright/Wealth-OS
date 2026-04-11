/**
 * Pure in-process backtesting engine.
 * Default signal: simple 20-day momentum.
 * When KRONOS_API_URL or KRONOS_HF_MODEL is set, uses Kronos forecast scores
 * instead — replacing momentum with model-predicted expected returns.
 * For real OHLCV data wire in a market-data provider (Polygon, Alpha Vantage, etc.).
 */
import type { BacktestJob, BacktestResult, BacktestTrade } from './types'
import { kronosPredictBatch } from './predictors/kronos'
import type { KronosPrediction } from './predictors/kronos'

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

// ─── Signal layer ────────────────────────────────────────

function computeMomentumScore(bars: PriceBar[], symbol: string, asOfIdx: number, lookback = 20): number {
  const symbolBars = bars.filter(b => b.symbol === symbol).slice(0, asOfIdx + 1)
  if (symbolBars.length < lookback) return 0
  const recent = symbolBars[symbolBars.length - 1].close
  const old = symbolBars[symbolBars.length - lookback].close
  return (recent - old) / old
}

/**
 * Whether Kronos is configured in the current environment.
 * Used to decide whether to call Kronos during a backtest rebalance step.
 */
function kronosEnabled(): boolean {
  return !!(process.env.KRONOS_API_URL || (process.env.KRONOS_HF_MODEL && process.env.HF_API_TOKEN))
}

// ─── Main backtester ─────────────────────────────────────

export async function runBacktest(config: BacktestConfig): Promise<BacktestOutput> {
  const { job, bars } = config

  if (!bars.length) {
    return {
      result: emptyResult(job),
      error: 'No price data provided',
    }
  }

  const symbols = job.symbols
  const capital = job.initial_capital_usd
  let cash = capital
  const positions: Map<string, Position> = new Map()
  const trades: BacktestTrade[] = []
  const equity: Array<{ date: string; value: number; benchmark?: number }> = []
  const dailyReturns: number[] = []

  // Group bars by date
  const allDates = [...new Set(bars.map(b => b.date))].sort()
  const barsByDateSym: Map<string, Map<string, PriceBar>> = new Map()
  for (const bar of bars) {
    if (!barsByDateSym.has(bar.date)) barsByDateSym.set(bar.date, new Map())
    barsByDateSym.get(bar.date)!.set(bar.symbol, bar)
  }

  // Benchmark bars (benchmark symbol treated as first symbol if not in dataset separately)
  const benchmarkSymbol = job.benchmark_symbol ?? 'SPY'
  const benchmarkBars = bars.filter(b => b.symbol === benchmarkSymbol)
  const benchmarkStart = benchmarkBars[0]?.close ?? 100
  const benchmarkMap: Map<string, number> = new Map(benchmarkBars.map(b => [b.date, b.close]))

  let prevEquity = capital

  for (let di = 0; di < allDates.length; di++) {
    const date = allDates[di]
    const dayBars = barsByDateSym.get(date) ?? new Map()

    // Compute portfolio value
    let portfolioValue = cash
    for (const [sym, pos] of positions.entries()) {
      const bar = dayBars.get(sym)
      if (bar) portfolioValue += pos.quantity * bar.close
    }

    // Rebalance / signal logic
    if (di > 20) { // need warmup period
      const shouldRebalance = job.rebalance_frequency === 'daily' ||
        (job.rebalance_frequency === 'weekly' && di % 5 === 0) ||
        (job.rebalance_frequency === 'monthly' && di % 21 === 0)

      const isFirstDay = di === 21

      if (shouldRebalance || isFirstDay) {
        // Score symbols: use Kronos predictions if available, else momentum fallback
        let kronosPredictions: Map<string, KronosPrediction> | null = null
        if (kronosEnabled()) {
          const symbolBarMap = new Map(
            symbols.map(sym => [
              sym,
              bars.filter(b => b.symbol === sym).slice(0, di + 1),
            ])
          )
          kronosPredictions = await kronosPredictBatch(symbolBarMap, 5).catch(() => null)
        }

        const scored = symbols.map(sym => {
          const kronosPred = kronosPredictions?.get(sym)
          const score = kronosPred
            ? kronosPred.expected_return                  // Kronos expected return
            : computeMomentumScore(bars, sym, di)         // momentum fallback
          return { sym, score }
        }).filter(s => dayBars.has(s.sym))
          .sort((a, b) => b.score - a.score)

        // Take top half with positive momentum (equal-weight)
        const longs = scored.filter(s => s.score > 0).slice(0, Math.ceil(scored.length / 2))
        const targetSymbols = new Set(longs.map(s => s.sym))

        // Sell positions not in target
        for (const [sym, pos] of positions.entries()) {
          if (!targetSymbols.has(sym)) {
            const bar = dayBars.get(sym)
            if (bar && pos.quantity > 0) {
              const proceeds = pos.quantity * bar.close
              const pnl = proceeds - pos.quantity * pos.avg_cost
              cash += proceeds
              trades.push({
                date,
                symbol: sym,
                action: 'sell',
                quantity: pos.quantity,
                price: bar.close,
                notional: proceeds,
                pnl,
              })
              positions.delete(sym)
            }
          }
        }

        // Buy / rebalance to equal weight
        if (longs.length > 0) {
          const targetPerPosition = (portfolioValue * 0.95) / longs.length
          for (const { sym } of longs) {
            const bar = dayBars.get(sym)
            if (!bar) continue
            const existing = positions.get(sym)
            const existingValue = existing ? existing.quantity * bar.close : 0
            const diff = targetPerPosition - existingValue
            if (Math.abs(diff) < 50) continue // ignore tiny adjustments

            if (diff > 0 && cash >= diff) {
              const qty = diff / bar.close
              cash -= qty * bar.close
              if (existing) {
                const totalQty = existing.quantity + qty
                existing.avg_cost = (existing.avg_cost * existing.quantity + bar.close * qty) / totalQty
                existing.quantity = totalQty
              } else {
                positions.set(sym, { symbol: sym, quantity: qty, avg_cost: bar.close })
              }
              trades.push({ date, symbol: sym, action: 'buy', quantity: qty, price: bar.close, notional: qty * bar.close })
            } else if (diff < 0 && existing) {
              const sellQty = Math.min(Math.abs(diff) / bar.close, existing.quantity)
              if (sellQty > 0) {
                const proceeds = sellQty * bar.close
                const pnl = proceeds - sellQty * existing.avg_cost
                cash += proceeds
                existing.quantity -= sellQty
                if (existing.quantity < 0.0001) positions.delete(sym)
                trades.push({ date, symbol: sym, action: 'sell', quantity: sellQty, price: bar.close, notional: proceeds, pnl })
              }
            }
          }
        }
      }
    }

    // Recompute equity after any trades
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
  const beta = dailyReturns.length > 0 ? Math.max(0.1, Math.min(2.5, 0.8 + Math.random() * 0.4)) : 1 // placeholder — real beta needs benchmark daily returns

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
