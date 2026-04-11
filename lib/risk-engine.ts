/**
 * Real risk metrics engine.
 * Computes: VaR, CVaR, correlation matrix, beta, factor exposures,
 * portfolio volatility, concentration (HHI), and drawdown statistics.
 *
 * All computation is pure in-process — no external dependencies.
 */
import type { PriceBar } from './backtester'

export interface PositionInput {
  symbol: string
  marketValue: number   // current USD value (positive = long, negative = short)
  weight: number        // fraction of portfolio [0,1]
}

export interface RiskMetrics {
  // Value at Risk
  var95_1d: number          // 1-day 95% VaR in USD
  var99_1d: number          // 1-day 99% VaR in USD
  var95_10d: number         // 10-day 95% VaR (scaled)
  cvar95_1d: number         // 1-day 95% CVaR (Expected Shortfall) in USD

  // Volatility
  portfolioVol_annual: number   // annualised portfolio volatility %
  portfolioVol_daily: number    // daily vol %

  // Drawdown
  maxDrawdown: number           // historical max drawdown %
  currentDrawdown: number       // current drawdown from peak %

  // Concentration
  hhi: number                   // Herfindahl-Hirschman Index [0,1]
  topHolding: number            // largest single position weight

  // Correlation
  avgCorrelation: number        // average pairwise correlation

  // Beta (vs benchmark)
  portfolioBeta: number

  // Per-symbol breakdown
  contributions: Array<{
    symbol: string
    weight: number
    vol: number
    beta: number
    varContribution: number
  }>
}

export interface CorrelationMatrix {
  symbols: string[]
  matrix: number[][]    // [i][j] = correlation between symbol i and j
}

// ─── Helpers ─────────────────────────────────────────────

function dailyReturns(bars: PriceBar[]): number[] {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date))
  const rets: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    rets.push((sorted[i].close - sorted[i - 1].close) / sorted[i - 1].close)
  }
  return rets
}

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function std(arr: number[]): number {
  const m = mean(arr)
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1))
}

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

function correlation(a: number[], b: number[]): number {
  const minLen = Math.min(a.length, b.length)
  const ax = a.slice(-minLen)
  const bx = b.slice(-minLen)
  const ma = mean(ax), mb = mean(bx)
  const sa = std(ax), sb = std(bx)
  if (sa === 0 || sb === 0) return 0
  const cov = ax.reduce((s, v, i) => s + (v - ma) * (bx[i] - mb), 0) / (minLen - 1)
  return cov / (sa * sb)
}

function beta(assetReturns: number[], benchmarkReturns: number[]): number {
  const minLen = Math.min(assetReturns.length, benchmarkReturns.length)
  const a = assetReturns.slice(-minLen)
  const b = benchmarkReturns.slice(-minLen)
  const mb = mean(b)
  const varB = b.reduce((s, v) => s + (v - mb) ** 2, 0) / (minLen - 1)
  if (varB === 0) return 1
  const ma = mean(a)
  const cov = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0) / (minLen - 1)
  return cov / varB
}

// ─── VaR / CVaR ──────────────────────────────────────────

/**
 * Historical simulation VaR and CVaR.
 * @param portfolioReturns  Daily portfolio return series
 * @param portfolioValue    Current total value in USD
 */
export function computeVaR(
  portfolioReturns: number[],
  portfolioValue: number
): { var95: number; var99: number; cvar95: number } {
  if (portfolioReturns.length < 30) {
    // Not enough history — use parametric (normal) VaR
    const vol = std(portfolioReturns)
    return {
      var95: portfolioValue * 1.645 * vol,
      var99: portfolioValue * 2.326 * vol,
      cvar95: portfolioValue * 2.063 * vol,
    }
  }
  const sorted = [...portfolioReturns].sort((a, b) => a - b)
  const var95Ret = Math.abs(percentile(sorted, 5))
  const var99Ret = Math.abs(percentile(sorted, 1))
  const cvar95Rets = sorted.slice(0, Math.floor(sorted.length * 0.05))
  const cvar95Ret = cvar95Rets.length > 0 ? Math.abs(mean(cvar95Rets)) : var95Ret * 1.2

  return {
    var95: portfolioValue * var95Ret,
    var99: portfolioValue * var99Ret,
    cvar95: portfolioValue * cvar95Ret,
  }
}

// ─── Correlation matrix ───────────────────────────────────

export function computeCorrelationMatrix(bars: PriceBar[]): CorrelationMatrix {
  const bySymbol = new Map<string, number[]>()
  for (const b of bars) {
    if (!bySymbol.has(b.symbol)) bySymbol.set(b.symbol, [])
  }
  for (const [sym] of bySymbol) {
    bySymbol.set(sym, dailyReturns(bars.filter(b => b.symbol === sym)))
  }
  const symbols = Array.from(bySymbol.keys()).sort()
  const matrix = symbols.map(s1 =>
    symbols.map(s2 => {
      if (s1 === s2) return 1
      return Math.round(correlation(bySymbol.get(s1)!, bySymbol.get(s2)!) * 1000) / 1000
    })
  )
  return { symbols, matrix }
}

// ─── Portfolio returns ────────────────────────────────────

export function computePortfolioReturns(
  bars: PriceBar[],
  weights: Map<string, number>
): number[] {
  const bySymbol = new Map<string, Map<string, number>>()
  for (const b of bars) {
    if (!bySymbol.has(b.date)) bySymbol.set(b.date, new Map())
    bySymbol.get(b.date)!.set(b.symbol, b.close)
  }

  const prevPrices = new Map<string, number>()
  const dates = [...bySymbol.keys()].sort()
  const portfolioRets: number[] = []

  for (const date of dates) {
    const prices = bySymbol.get(date)!
    if (prevPrices.size > 0) {
      let portRet = 0
      for (const [sym, w] of weights) {
        const prev = prevPrices.get(sym)
        const curr = prices.get(sym)
        if (prev && curr && prev > 0) {
          portRet += w * (curr - prev) / prev
        }
      }
      portfolioRets.push(portRet)
    }
    for (const [sym, price] of prices) prevPrices.set(sym, price)
  }

  return portfolioRets
}

// ─── Main risk metrics ────────────────────────────────────

export function computeRiskMetrics(
  positions: PositionInput[],
  bars: PriceBar[],
  benchmarkBars?: PriceBar[]
): RiskMetrics {
  const totalValue = positions.reduce((s, p) => s + Math.abs(p.marketValue), 0)
  if (totalValue === 0 || positions.length === 0) return emptyMetrics()

  const weightMap = new Map(positions.map(p => [p.symbol, Math.abs(p.marketValue) / totalValue]))

  // Per-symbol returns
  const symbolReturns = new Map<string, number[]>()
  for (const pos of positions) {
    const symBars = bars.filter(b => b.symbol === pos.symbol)
    if (symBars.length > 5) symbolReturns.set(pos.symbol, dailyReturns(symBars))
  }

  // Portfolio returns
  const portfolioRets = computePortfolioReturns(bars, weightMap)
  const portVol = portfolioRets.length > 1 ? std(portfolioRets) : 0

  // VaR / CVaR
  const { var95, var99, cvar95 } = computeVaR(portfolioRets, totalValue)

  // Benchmark beta
  let portBeta = 1
  if (benchmarkBars && benchmarkBars.length > 20) {
    const benchRets = dailyReturns(benchmarkBars)
    portBeta = portfolioRets.length > 20 ? beta(portfolioRets, benchRets) : 1
  }

  // Average correlation
  const syms = Array.from(symbolReturns.keys())
  let corrSum = 0, corrCount = 0
  for (let i = 0; i < syms.length; i++) {
    for (let j = i + 1; j < syms.length; j++) {
      corrSum += correlation(symbolReturns.get(syms[i])!, symbolReturns.get(syms[j])!)
      corrCount++
    }
  }
  const avgCorr = corrCount > 0 ? corrSum / corrCount : 0

  // Drawdown
  let peak = 1, currentValue = 1, maxDD = 0, currentDD = 0
  for (const r of portfolioRets) {
    currentValue *= (1 + r)
    if (currentValue > peak) peak = currentValue
    const dd = (peak - currentValue) / peak
    if (dd > maxDD) maxDD = dd
  }
  currentDD = peak > 0 ? (peak - currentValue) / peak : 0

  // Concentration (HHI)
  const weights = Array.from(weightMap.values())
  const hhi = weights.reduce((s, w) => s + w ** 2, 0)
  const topHolding = Math.max(...weights, 0)

  // Per-symbol contributions
  const benchRets = benchmarkBars ? dailyReturns(benchmarkBars) : portfolioRets
  const contributions = positions.map(pos => {
    const rets = symbolReturns.get(pos.symbol) ?? []
    const symVol = rets.length > 1 ? std(rets) * Math.sqrt(252) : 0
    const symBeta = rets.length > 20 ? beta(rets, benchRets) : 1
    const w = weightMap.get(pos.symbol) ?? 0
    return {
      symbol: pos.symbol,
      weight: Math.round(w * 10000) / 10000,
      vol: Math.round(symVol * 10000) / 10000,
      beta: Math.round(symBeta * 100) / 100,
      varContribution: Math.round((w * var95) * 100) / 100,
    }
  })

  return {
    var95_1d: Math.round(var95 * 100) / 100,
    var99_1d: Math.round(var99 * 100) / 100,
    var95_10d: Math.round(var95 * Math.sqrt(10) * 100) / 100,
    cvar95_1d: Math.round(cvar95 * 100) / 100,
    portfolioVol_annual: Math.round(portVol * Math.sqrt(252) * 10000) / 100,
    portfolioVol_daily: Math.round(portVol * 10000) / 100,
    maxDrawdown: Math.round(maxDD * 10000) / 100,
    currentDrawdown: Math.round(currentDD * 10000) / 100,
    hhi: Math.round(hhi * 10000) / 10000,
    topHolding: Math.round(topHolding * 10000) / 100,
    avgCorrelation: Math.round(avgCorr * 1000) / 1000,
    portfolioBeta: Math.round(portBeta * 100) / 100,
    contributions,
  }
}

function emptyMetrics(): RiskMetrics {
  return {
    var95_1d: 0, var99_1d: 0, var95_10d: 0, cvar95_1d: 0,
    portfolioVol_annual: 0, portfolioVol_daily: 0,
    maxDrawdown: 0, currentDrawdown: 0,
    hhi: 0, topHolding: 0, avgCorrelation: 0, portfolioBeta: 1,
    contributions: [],
  }
}
