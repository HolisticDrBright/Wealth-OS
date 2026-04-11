/**
 * Advanced backtesting: Walk-Forward Analysis + Monte Carlo simulation.
 * Builds on the core runBacktest() engine in lib/backtester.ts.
 */
import { runBacktest, type PriceBar, type BacktestConfig } from './backtester'
import type { BacktestJob, BacktestResult } from './types'

// ─── Walk-Forward ─────────────────────────────────────────

export interface WalkForwardConfig {
  job: BacktestJob
  bars: PriceBar[]
  /** Training window in trading days, default 252 (1 year) */
  trainDays?: number
  /** Test window in trading days, default 63 (1 quarter) */
  testDays?: number
}

export interface WalkForwardWindow {
  trainStart: string
  trainEnd: string
  testStart: string
  testEnd: string
  trainResult: Omit<BacktestResult, 'id' | 'created_at'>
  testResult: Omit<BacktestResult, 'id' | 'created_at'>
}

export interface WalkForwardOutput {
  windows: WalkForwardWindow[]
  /** Average out-of-sample metrics across all test windows */
  avgOutOfSample: {
    totalReturnPct: number
    sharpe: number
    maxDrawdown: number
    winRate: number
  }
  /** Ratio of out-of-sample Sharpe to in-sample Sharpe (>0.5 is healthy) */
  robustnessRatio: number
}

export async function runWalkForward(config: WalkForwardConfig): Promise<WalkForwardOutput> {
  const { job, bars, trainDays = 252, testDays = 63 } = config

  const allDates = [...new Set(bars.map(b => b.date))].sort()
  const windows: WalkForwardWindow[] = []

  let cursor = trainDays
  while (cursor + testDays <= allDates.length) {
    const trainStart = allDates[cursor - trainDays]
    const trainEnd = allDates[cursor - 1]
    const testStart = allDates[cursor]
    const testEnd = allDates[Math.min(cursor + testDays - 1, allDates.length - 1)]

    const trainBars = bars.filter(b => b.date >= trainStart && b.date <= trainEnd)
    const testBars = bars.filter(b => b.date >= testStart && b.date <= testEnd)

    const trainJob = { ...job, start_date: trainStart, end_date: trainEnd }
    const testJob = { ...job, start_date: testStart, end_date: testEnd }

    const [trainOut, testOut] = await Promise.all([
      runBacktest({ job: trainJob, bars: trainBars }),
      runBacktest({ job: testJob, bars: testBars }),
    ])

    windows.push({
      trainStart, trainEnd, testStart, testEnd,
      trainResult: trainOut.result,
      testResult: testOut.result,
    })

    cursor += testDays
  }

  if (!windows.length) {
    return {
      windows: [],
      avgOutOfSample: { totalReturnPct: 0, sharpe: 0, maxDrawdown: 0, winRate: 0 },
      robustnessRatio: 0,
    }
  }

  const avgOOS = {
    totalReturnPct: avg(windows.map(w => w.testResult.total_return_pct ?? 0)),
    sharpe: avg(windows.map(w => w.testResult.sharpe_ratio ?? 0)),
    maxDrawdown: avg(windows.map(w => w.testResult.max_drawdown_pct ?? 0)),
    winRate: avg(windows.map(w => w.testResult.win_rate_pct ?? 0)),
  }

  const avgInSampleSharpe = avg(windows.map(w => w.trainResult.sharpe_ratio ?? 0))
  const robustnessRatio = avgInSampleSharpe > 0
    ? Math.round((avgOOS.sharpe / avgInSampleSharpe) * 100) / 100
    : 0

  return { windows, avgOutOfSample: avgOOS, robustnessRatio }
}

// ─── Monte Carlo ──────────────────────────────────────────

export interface MonteCarloConfig {
  /** Historical daily portfolio returns */
  portfolioReturns: number[]
  /** Starting portfolio value in USD */
  initialValue: number
  /** Number of trading days to simulate forward */
  horizonDays?: number
  /** Number of simulation paths */
  simulations?: number
}

export interface MonteCarloOutput {
  /** Percentile equity paths: p5, p25, p50, p75, p95 */
  percentiles: {
    p5: number[]
    p25: number[]
    p50: number[]
    p75: number[]
    p95: number[]
  }
  /** Final value distribution */
  finalValues: {
    p5: number
    p25: number
    p50: number
    p75: number
    p95: number
    mean: number
  }
  /** Probability of loss (final value < initial) */
  probOfLoss: number
  /** Probability of +10% gain */
  probOf10PctGain: number
  /** Probability of -20% loss (ruin threshold) */
  probOfRuin: number
}

export function runMonteCarlo(config: MonteCarloConfig): MonteCarloOutput {
  const {
    portfolioReturns,
    initialValue,
    horizonDays = 252,
    simulations = 1000,
  } = config

  if (portfolioReturns.length < 20) {
    const empty = new Array(horizonDays).fill(initialValue)
    const emptyPercentiles = { p5: empty, p25: empty, p50: empty, p75: empty, p95: empty }
    return {
      percentiles: emptyPercentiles,
      finalValues: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0, mean: 0 },
      probOfLoss: 0, probOf10PctGain: 0, probOfRuin: 0,
    }
  }

  const mu = mean(portfolioReturns)
  const sigma = std(portfolioReturns)

  // Bootstrap resampling with slight drift randomisation
  const finalValues: number[] = []
  const paths: number[][] = []

  // Simple LCG for reproducible fast random
  let seed = 42
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0xffffffff
  }
  // Box-Muller transform
  const randn = () => {
    const u = Math.max(rand(), 1e-10)
    const v = rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  for (let s = 0; s < simulations; s++) {
    const path = [initialValue]
    let value = initialValue
    for (let d = 0; d < horizonDays; d++) {
      // Resample from historical returns with small GBM noise
      const histReturn = portfolioReturns[Math.floor(rand() * portfolioReturns.length)]
      const noise = 0.1 * sigma * randn()
      value *= (1 + histReturn + noise)
      path.push(Math.max(0, value))
    }
    finalValues.push(value)
    if (s < 500) paths.push(path) // store first 500 paths for percentile curves
  }

  // Compute percentile curves across days
  const p5: number[] = [], p25: number[] = [], p50: number[] = [],
    p75: number[] = [], p95: number[] = []

  for (let d = 0; d <= horizonDays; d++) {
    const dayValues = paths.map(p => p[d]).sort((a, b) => a - b)
    p5.push(pct(dayValues, 5))
    p25.push(pct(dayValues, 25))
    p50.push(pct(dayValues, 50))
    p75.push(pct(dayValues, 75))
    p95.push(pct(dayValues, 95))
  }

  const sortedFinals = [...finalValues].sort((a, b) => a - b)

  return {
    percentiles: { p5, p25, p50, p75, p95 },
    finalValues: {
      p5: Math.round(pct(sortedFinals, 5)),
      p25: Math.round(pct(sortedFinals, 25)),
      p50: Math.round(pct(sortedFinals, 50)),
      p75: Math.round(pct(sortedFinals, 75)),
      p95: Math.round(pct(sortedFinals, 95)),
      mean: Math.round(mean(finalValues)),
    },
    probOfLoss: Math.round((finalValues.filter(v => v < initialValue).length / simulations) * 10000) / 100,
    probOf10PctGain: Math.round((finalValues.filter(v => v > initialValue * 1.1).length / simulations) * 10000) / 100,
    probOfRuin: Math.round((finalValues.filter(v => v < initialValue * 0.8).length / simulations) * 10000) / 100,
  }
}

// ─── Helpers ─────────────────────────────────────────────

function avg(arr: number[]): number {
  return arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 100) / 100 : 0
}

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function std(arr: number[]): number {
  const m = mean(arr)
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1))
}

function pct(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}
