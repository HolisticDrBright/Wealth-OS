/**
 * BRKME-methodology promotion gates.
 * All 6 gates must pass before any strategy advances from paper to live capital.
 *
 * Gate thresholds (BRKME):
 *   1. tradeCount >= 100
 *   2. tStat > 2.0
 *   3. roiNetCosts > 0
 *   4. excessVsBaseline > 0
 *   5. maxDrawdownPct < 0.30
 *   6. profitFactor > 1.2
 */

export interface BacktestRow {
  /** Fractional return for this trade, e.g. 0.03 = +3%. */
  returnPct: number
  /** Baseline instrument return over the same hold period (SPY/BTC/EURUSD). */
  baselineReturnPct: number
  /** One-way transaction cost as fraction of notional, e.g. 0.001 = 10 bps. */
  costPct?: number
}

export interface PromotionGateMetrics {
  tradeCount: number
  tStat: number
  roiNetCosts: number
  baselineRoi: number
  excessVsBaseline: number
  maxDrawdownPct: number
  profitFactor: number
  sharpe: number
}

export interface PromotionGateResult {
  passed: boolean
  failedGates: string[]
  metrics: PromotionGateMetrics
}

export const PROMOTION_GATE_THRESHOLDS = {
  minTradeCount:      100,
  minTStat:           2.0,
  minRoiNetCosts:     0,
  minExcessVsBaseline: 0,
  maxDrawdownPct:     0.30,
  minProfitFactor:    1.2,
} as const

/**
 * Evaluate all 6 promotion gates against an array of backtest rows.
 * @param rows      Per-trade results from the paper-trading backtest.
 * @param assetClass Used for baseline selection in the future; currently unused.
 * @param options   Reserved for future overrides.
 */
export function evaluatePromotionGates(
  rows: BacktestRow[],
  assetClass?: string,
  options?: Record<string, unknown>
): PromotionGateResult {
  void assetClass
  void options

  const failedGates: string[] = []
  const metrics = computeMetrics(rows)
  const T = PROMOTION_GATE_THRESHOLDS

  if (metrics.tradeCount < T.minTradeCount) {
    failedGates.push(
      `tradeCount ${metrics.tradeCount} < ${T.minTradeCount}`
    )
  }
  if (metrics.tStat <= T.minTStat) {
    failedGates.push(
      `tStat ${metrics.tStat.toFixed(2)} <= ${T.minTStat}`
    )
  }
  if (metrics.roiNetCosts <= T.minRoiNetCosts) {
    failedGates.push(
      `roiNetCosts ${(metrics.roiNetCosts * 100).toFixed(2)}% <= 0`
    )
  }
  if (metrics.excessVsBaseline <= T.minExcessVsBaseline) {
    failedGates.push(
      `excessVsBaseline ${(metrics.excessVsBaseline * 100).toFixed(2)}% <= 0`
    )
  }
  if (metrics.maxDrawdownPct >= T.maxDrawdownPct) {
    failedGates.push(
      `maxDrawdown ${(metrics.maxDrawdownPct * 100).toFixed(1)}% >= ${T.maxDrawdownPct * 100}%`
    )
  }
  if (metrics.profitFactor <= T.minProfitFactor) {
    failedGates.push(
      `profitFactor ${metrics.profitFactor.toFixed(2)} <= ${T.minProfitFactor}`
    )
  }

  return { passed: failedGates.length === 0, failedGates, metrics }
}

// --- Internal ----------------------------------------------------------------

function computeMetrics(rows: BacktestRow[]): PromotionGateMetrics {
  const n = rows.length
  if (n === 0) {
    return {
      tradeCount: 0, tStat: 0, roiNetCosts: 0, baselineRoi: 0,
      excessVsBaseline: 0, maxDrawdownPct: 0, profitFactor: 0, sharpe: 0,
    }
  }

  const net = rows.map(r => r.returnPct - (r.costPct ?? 0))
  const baselineRoi = rows.reduce((s, r) => s + r.baselineReturnPct, 0)
  const roiNetCosts = net.reduce((s, v) => s + v, 0)
  const excessVsBaseline = roiNetCosts - baselineRoi

  // t-statistic = mean / (std / sqrt(n))
  const mean = roiNetCosts / n
  const variance = net.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(n - 1, 1)
  const std = Math.sqrt(variance)
  const tStat = std > 0 ? mean / (std / Math.sqrt(n)) : 0

  // Peak-to-trough max drawdown
  let peak = 0
  let equity = 0
  let maxDD = 0
  for (const r of net) {
    equity += r
    if (equity > peak) peak = equity
    const dd = peak > 0 ? (peak - equity) / peak : 0
    if (dd > maxDD) maxDD = dd
  }

  // Profit factor = sum(gains) / |sum(losses)|
  const gains  = net.filter(r => r > 0).reduce((s, v) => s + v, 0)
  const losses = net.filter(r => r < 0).reduce((s, v) => s + v, 0)
  const profitFactor = losses < 0 ? gains / Math.abs(losses) : gains > 0 ? Infinity : 0

  // Annualised Sharpe (assumes daily trade frequency)
  const rf = 0.05 / 252
  const excess = net.map(r => r - rf)
  const exMean = excess.reduce((s, v) => s + v, 0) / n
  const exStd = Math.sqrt(
    excess.reduce((s, r) => s + (r - exMean) ** 2, 0) / Math.max(n - 1, 1)
  )
  const sharpe = exStd > 0 ? (exMean / exStd) * Math.sqrt(252) : 0

  return {
    tradeCount: n, tStat, roiNetCosts, baselineRoi, excessVsBaseline,
    maxDrawdownPct: maxDD, profitFactor, sharpe,
  }
}
