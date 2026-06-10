/**
 * Promotion gates — quantitative criteria a strategy must clear before moving
 * up the maturity ladder. Previously promotion was a judgment call; this makes
 * the bar explicit and auditable.
 *
 *   backtest_ready → paper_trading
 *     · walk-forward robustness ratio ≥ 0.5 (OOS Sharpe / IS Sharpe)
 *     · positive net-of-cost out-of-sample return
 *
 *   paper_trading → live_candidate
 *     · ≥ 30 closed paper trades
 *     · net expectancy > 0 after venue costs
 *     · rolling Brier < 0.22 (well-enough calibrated)
 *     · max drawdown within budget (≤ 15% of allocated notional)
 *     · shadow check: the gates aren't destroying alpha — accepted trades
 *       must not underperform the strategy's rejected (shadow) trades by a
 *       wide margin
 *
 * This module only COMPUTES readiness. Changing maturityStatus stays a manual,
 * explicit registry edit — stub and retired strategies must never execute, and
 * nothing here automates a promotion.
 */

import { roundTripCostBps } from '@/lib/costs/transaction-costs'

export interface PromotionCriterion {
  name: string
  /** Human-readable requirement, e.g. "≥ 30 closed trades". */
  required: string
  /** Human-readable actual, e.g. "12 closed trades". */
  actual: string
  pass: boolean
  /** False when the underlying data source had no data — display as unknown. */
  evaluable: boolean
}

export interface PromotionReadiness {
  strategyKey: string
  currentStatus: string
  nextStatus: string | null
  criteria: PromotionCriterion[]
  /** True only when every evaluable criterion passes AND all criteria are evaluable. */
  ready: boolean
}

export interface PaperTradeStats {
  closedTrades: number
  /** Mean realized return per closed trade, as a fraction (slippage included). */
  avgReturnPct: number | null
  /** Worst peak-to-trough drawdown as a fraction of allocated notional. */
  maxDrawdownPct: number | null
  assetClass: string
}

export interface ShadowComparison {
  /** Mean realized return of the strategy's closed shadow (rejected) trades. */
  shadowAvgReturnPct: number | null
  closedShadowTrades: number
}

const MIN_CLOSED_TRADES = 30
const MAX_BRIER = 0.22
const MAX_DRAWDOWN = 0.15
/** Shadow may beat real by at most this much before we flag the gates. */
const MAX_SHADOW_EDGE = 0.01
const MIN_SHADOW_SAMPLES = 5

export function evaluatePaperToLive(
  strategyKey: string,
  stats: PaperTradeStats,
  rollingBrier: number | null,
  shadow: ShadowComparison,
): PromotionReadiness {
  const criteria: PromotionCriterion[] = []

  // 1. Sample size
  criteria.push({
    name: 'Sample size',
    required: `≥ ${MIN_CLOSED_TRADES} closed paper trades`,
    actual: `${stats.closedTrades} closed`,
    pass: stats.closedTrades >= MIN_CLOSED_TRADES,
    evaluable: true,
  })

  // 2. Net expectancy after venue costs. Paper fills already paid slippage;
  //    we additionally require clearing the explicit fee component so a
  //    strategy that only beats the spread doesn't get promoted.
  const feeDrag = roundTripCostBps(stats.assetClass) / 10_000
  if (stats.avgReturnPct === null) {
    criteria.push({
      name: 'Net expectancy', required: '> 0 after costs', actual: 'no closed trades',
      pass: false, evaluable: false,
    })
  } else {
    const net = stats.avgReturnPct - feeDrag
    criteria.push({
      name: 'Net expectancy',
      required: `> 0 after ~${Math.round(feeDrag * 10_000)} bps round trip`,
      actual: `${(net * 100).toFixed(2)}% per trade net`,
      pass: net > 0,
      evaluable: true,
    })
  }

  // 3. Calibration
  if (rollingBrier === null) {
    criteria.push({
      name: 'Calibration', required: `Brier < ${MAX_BRIER}`, actual: 'insufficient graded outcomes',
      pass: false, evaluable: false,
    })
  } else {
    criteria.push({
      name: 'Calibration',
      required: `Brier < ${MAX_BRIER}`,
      actual: `Brier ${rollingBrier.toFixed(3)}`,
      pass: rollingBrier < MAX_BRIER,
      evaluable: true,
    })
  }

  // 4. Drawdown
  if (stats.maxDrawdownPct === null) {
    criteria.push({
      name: 'Drawdown', required: `≤ ${MAX_DRAWDOWN * 100}%`, actual: 'not yet measurable',
      pass: false, evaluable: false,
    })
  } else {
    criteria.push({
      name: 'Drawdown',
      required: `≤ ${MAX_DRAWDOWN * 100}%`,
      actual: `${(stats.maxDrawdownPct * 100).toFixed(1)}%`,
      pass: stats.maxDrawdownPct <= MAX_DRAWDOWN,
      evaluable: true,
    })
  }

  // 5. Shadow check — are the decision gates helping?
  if (shadow.shadowAvgReturnPct === null || shadow.closedShadowTrades < MIN_SHADOW_SAMPLES) {
    criteria.push({
      name: 'Shadow check',
      required: 'rejected trades must not outperform accepted',
      actual: `only ${shadow.closedShadowTrades} resolved shadow trades`,
      pass: false, evaluable: false,
    })
  } else if (stats.avgReturnPct === null) {
    criteria.push({
      name: 'Shadow check',
      required: 'rejected trades must not outperform accepted',
      actual: 'no closed real trades to compare',
      pass: false, evaluable: false,
    })
  } else {
    const shadowEdge = shadow.shadowAvgReturnPct - stats.avgReturnPct
    criteria.push({
      name: 'Shadow check',
      required: `shadow edge ≤ ${MAX_SHADOW_EDGE * 100}% per trade`,
      actual: shadowEdge > 0
        ? `rejected beat accepted by ${(shadowEdge * 100).toFixed(2)}%/trade`
        : `accepted beat rejected by ${(-shadowEdge * 100).toFixed(2)}%/trade`,
      pass: shadowEdge <= MAX_SHADOW_EDGE,
      evaluable: true,
    })
  }

  const allEvaluable = criteria.every(c => c.evaluable)
  const allPass = criteria.every(c => !c.evaluable || c.pass)

  return {
    strategyKey,
    currentStatus: 'paper_trading',
    nextStatus: 'live_candidate',
    criteria,
    ready: allEvaluable && allPass,
  }
}

export interface WalkForwardStats {
  robustnessRatio: number | null
  oosTotalReturnPct: number | null
}

export function evaluateBacktestToPaper(
  strategyKey: string,
  wf: WalkForwardStats,
): PromotionReadiness {
  const criteria: PromotionCriterion[] = []

  if (wf.robustnessRatio === null) {
    criteria.push({
      name: 'Walk-forward robustness', required: 'OOS/IS Sharpe ≥ 0.5',
      actual: 'no walk-forward run recorded', pass: false, evaluable: false,
    })
  } else {
    criteria.push({
      name: 'Walk-forward robustness',
      required: 'OOS/IS Sharpe ≥ 0.5',
      actual: `ratio ${wf.robustnessRatio.toFixed(2)}`,
      pass: wf.robustnessRatio >= 0.5,
      evaluable: true,
    })
  }

  if (wf.oosTotalReturnPct === null) {
    criteria.push({
      name: 'Out-of-sample return', required: '> 0% net of costs',
      actual: 'no walk-forward run recorded', pass: false, evaluable: false,
    })
  } else {
    criteria.push({
      name: 'Out-of-sample return',
      required: '> 0% net of costs',
      actual: `${wf.oosTotalReturnPct.toFixed(1)}%`,
      pass: wf.oosTotalReturnPct > 0,
      evaluable: true,
    })
  }

  const allEvaluable = criteria.every(c => c.evaluable)
  const allPass = criteria.every(c => !c.evaluable || c.pass)

  return {
    strategyKey,
    currentStatus: 'backtest_ready',
    nextStatus: 'paper_trading',
    criteria,
    ready: allEvaluable && allPass,
  }
}
