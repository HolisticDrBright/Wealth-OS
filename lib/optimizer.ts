/**
 * Portfolio optimization engine.
 * Implements three strategies:
 *   1. Mean-Variance (Markowitz) — maximize Sharpe ratio
 *   2. Risk Parity — equal risk contribution per asset
 *   3. Equal Weight — naive baseline
 *
 * All computation is pure in-process (no external dependencies).
 * Input: historical daily returns per symbol.
 * Output: target weights Map<symbol, weight>.
 */

import type { PriceBar } from './backtester'

export type OptimizationStrategy = 'mean_variance' | 'risk_parity' | 'equal_weight' | 'min_variance'

export interface OptimizationInput {
  bars: PriceBar[]
  strategy: OptimizationStrategy
  /** Maximum weight per asset [0,1], default 0.4 */
  maxWeight?: number
  /** Minimum weight per asset [0,1], default 0 */
  minWeight?: number
  /** Risk-free rate annual, default 0.05 */
  riskFreeRate?: number
  /** Target portfolio volatility (annual), used by risk parity */
  targetVol?: number
}

export interface OptimizationResult {
  weights: Map<string, number>
  expectedReturn: number     // annualised
  expectedVol: number        // annualised
  sharpe: number
  strategy: OptimizationStrategy
  diagnostics: Record<string, number>
}

// ─── Math helpers ────────────────────────────────────────

function dotProduct(a: number[], b: number[]): number {
  return a.reduce((s, v, i) => s + v * b[i], 0)
}

function matMul(A: number[][], b: number[]): number[] {
  return A.map(row => dotProduct(row, b))
}

/** Compute daily returns from price bars for each symbol. */
function computeReturns(bars: PriceBar[]): Map<string, number[]> {
  const bySymbol = new Map<string, PriceBar[]>()
  for (const bar of bars) {
    if (!bySymbol.has(bar.symbol)) bySymbol.set(bar.symbol, [])
    bySymbol.get(bar.symbol)!.push(bar)
  }

  const returns = new Map<string, number[]>()
  for (const [sym, symBars] of bySymbol) {
    const sorted = symBars.sort((a, b) => a.date.localeCompare(b.date))
    const rets: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      rets.push((sorted[i].close - sorted[i - 1].close) / sorted[i - 1].close)
    }
    if (rets.length > 20) returns.set(sym, rets)
  }
  return returns
}

/** Align returns to common date count (min across symbols). */
function alignReturns(returns: Map<string, number[]>): { symbols: string[]; matrix: number[][] } {
  const symbols = Array.from(returns.keys())
  const minLen = Math.min(...symbols.map(s => returns.get(s)!.length))
  const matrix = symbols.map(s => returns.get(s)!.slice(-minLen))
  return { symbols, matrix }
}

/** Compute covariance matrix (annualised). */
function covarianceMatrix(matrix: number[][]): number[][] {
  const n = matrix.length
  const T = matrix[0].length
  const means = matrix.map(r => r.reduce((s, v) => s + v, 0) / T)
  const cov: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let sum = 0
      for (let t = 0; t < T; t++) {
        sum += (matrix[i][t] - means[i]) * (matrix[j][t] - means[j])
      }
      cov[i][j] = cov[j][i] = (sum / (T - 1)) * 252 // annualise
    }
  }
  return cov
}

/** Portfolio variance given weights and covariance matrix. */
function portfolioVariance(weights: number[], cov: number[][]): number {
  const covW = matMul(cov, weights)
  return dotProduct(weights, covW)
}

/** Portfolio expected return given weights and mean returns. */
function portfolioReturn(weights: number[], means: number[]): number {
  return dotProduct(weights, means) * 252
}

// ─── Equal weight ────────────────────────────────────────

function equalWeight(symbols: string[]): Map<string, number> {
  const w = 1 / symbols.length
  return new Map(symbols.map(s => [s, w]))
}

// ─── Risk parity ─────────────────────────────────────────
// Each asset contributes equally to total portfolio risk.
// Solved iteratively via gradient descent on risk contributions.

function riskParity(symbols: string[], cov: number[][], maxIter = 500): number[] {
  const n = symbols.length
  let w = new Array(n).fill(1 / n)
  const lr = 0.01
  const target = 1 / n // equal risk contribution

  for (let iter = 0; iter < maxIter; iter++) {
    const sigma2 = portfolioVariance(w, cov)
    const sigma = Math.sqrt(Math.max(sigma2, 1e-10))
    const covW = matMul(cov, w)
    // Marginal risk contributions
    const mrc = covW.map(c => c / sigma)
    const rc = w.map((wi, i) => wi * mrc[i])  // risk contributions
    const totalRc = rc.reduce((s, v) => s + v, 0)

    let maxDiff = 0
    for (let i = 0; i < n; i++) {
      const rcPct = rc[i] / totalRc
      const grad = rcPct - target
      w[i] = Math.max(0.001, w[i] - lr * grad)
      maxDiff = Math.max(maxDiff, Math.abs(grad))
    }
    // Normalise
    const sum = w.reduce((s, v) => s + v, 0)
    w = w.map(v => v / sum)
    if (maxDiff < 1e-6) break
  }
  return w
}

// ─── Mean-variance (max Sharpe) ──────────────────────────
// Gradient ascent on Sharpe ratio with weight constraints.

function meanVariance(
  symbols: string[],
  cov: number[][],
  means: number[],
  riskFree = 0.05,
  maxW = 0.4,
  minW = 0.0,
  maxIter = 1000
): number[] {
  const n = symbols.length
  let w = new Array(n).fill(1 / n)
  const lr = 0.005

  for (let iter = 0; iter < maxIter; iter++) {
    const ret = portfolioReturn(w, means)
    const variance = portfolioVariance(w, cov)
    const sigma = Math.sqrt(Math.max(variance, 1e-10))
    const sharpe = (ret - riskFree) / sigma
    const covW = matMul(cov, w)

    // dSharpe/dw_i = [252 * means[i] * sigma - (ret - rf) * covW[i] / sigma] / variance
    const grad = means.map((mu, i) => {
      const dRet = mu * 252
      const dSigma = covW[i] / sigma
      return (dRet * sigma - (ret - riskFree) * dSigma) / variance
    })

    for (let i = 0; i < n; i++) {
      w[i] = Math.max(minW, Math.min(maxW, w[i] + lr * grad[i]))
    }

    // Project to simplex (sum to 1, respect bounds)
    const sum = w.reduce((s, v) => s + v, 0)
    if (sum > 0) w = w.map(v => v / sum)

    // Re-clamp after normalisation
    let excess = 0
    let free = 0
    for (let i = 0; i < n; i++) {
      if (w[i] > maxW) { excess += w[i] - maxW; w[i] = maxW }
      else if (w[i] < minW) { excess -= minW - w[i]; w[i] = minW }
      else free++
    }
    if (excess > 0 && free > 0) {
      const adj = excess / free
      for (let i = 0; i < n; i++) {
        if (w[i] > minW && w[i] < maxW) w[i] = Math.max(minW, Math.min(maxW, w[i] + adj))
      }
    }

    if (iter > 100 && Math.abs(sharpe) > 0 && Math.max(...grad.map(Math.abs)) < 1e-5) break
  }

  return w
}

// ─── Min variance ────────────────────────────────────────

function minVariance(
  symbols: string[],
  cov: number[][],
  maxW = 0.4,
  minW = 0.0,
  maxIter = 500
): number[] {
  const n = symbols.length
  let w = new Array(n).fill(1 / n)
  const lr = 0.01

  for (let iter = 0; iter < maxIter; iter++) {
    const covW = matMul(cov, w)
    // Gradient of portfolio variance wrt weights = 2 * Cov * w
    for (let i = 0; i < n; i++) {
      w[i] = Math.max(minW, Math.min(maxW, w[i] - lr * 2 * covW[i]))
    }
    const sum = w.reduce((s, v) => s + v, 0)
    if (sum > 0) w = w.map(v => v / sum)
    if (iter > 100 && Math.max(...covW.map(Math.abs)) < 1e-6) break
  }
  return w
}

// ─── Public API ───────────────────────────────────────────

export function optimizePortfolio(input: OptimizationInput): OptimizationResult {
  const { bars, strategy, maxWeight = 0.4, minWeight = 0, riskFreeRate = 0.05 } = input

  const returns = computeReturns(bars)
  if (returns.size < 2) {
    const symbols = [...new Set(bars.map(b => b.symbol))]
    const weights = equalWeight(symbols)
    return { weights, expectedReturn: 0, expectedVol: 0, sharpe: 0, strategy, diagnostics: {} }
  }

  const { symbols, matrix } = alignReturns(returns)
  const cov = covarianceMatrix(matrix)
  const T = matrix[0].length
  const means = matrix.map(r => r.reduce((s, v) => s + v, 0) / T)

  let rawWeights: number[]

  switch (strategy) {
    case 'mean_variance':
      rawWeights = meanVariance(symbols, cov, means, riskFreeRate, maxWeight, minWeight)
      break
    case 'risk_parity':
      rawWeights = riskParity(symbols, cov)
      break
    case 'min_variance':
      rawWeights = minVariance(symbols, cov, maxWeight, minWeight)
      break
    default:
      rawWeights = symbols.map(() => 1 / symbols.length)
  }

  const weightMap = new Map(symbols.map((s, i) => [s, Math.round(rawWeights[i] * 10000) / 10000]))

  const expRet = portfolioReturn(rawWeights, means)
  const expVar = portfolioVariance(rawWeights, cov)
  const expVol = Math.sqrt(Math.max(expVar, 0))
  const sharpe = expVol > 0 ? (expRet - riskFreeRate) / expVol : 0

  const diagnostics: Record<string, number> = {}
  for (let i = 0; i < symbols.length; i++) {
    diagnostics[`vol_${symbols[i]}`] = Math.round(Math.sqrt(cov[i][i]) * 10000) / 10000
  }

  return {
    weights: weightMap,
    expectedReturn: Math.round(expRet * 10000) / 10000,
    expectedVol: Math.round(expVol * 10000) / 10000,
    sharpe: Math.round(sharpe * 10000) / 10000,
    strategy,
    diagnostics,
  }
}
