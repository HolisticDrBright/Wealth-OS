/**
 * BaseStrategy — abstract superclass for all 39 strategy implementations.
 *
 * Each subclass declares:
 *   - id: unique strategy key (matches STRATEGY_AI_CONFIG keys)
 *   - displayName: human-readable name
 *   - edgeClassification: 'momentum'|'reversion'|'factor'|'macro'|'sentiment'|'arb'|'systematic'
 *   - defaultBroker: which broker this strategy routes to by default
 *   - generateSignal(): produce a raw signal from market data
 *
 * The orchestrator (StrategyOrchestrator) runs all pipeline stages:
 *   detect → classify → MiroFish → Kronos → RedTeam → Risk → Size → Execute → Audit
 */

import type { PriceBar } from '@/lib/backtester'
import type { KronosConfluenceResult } from '@/lib/predictors/kronos-confluence'
import type { SimulationReport } from '@/lib/agents/types'

export type EdgeClassification = 'momentum' | 'reversion' | 'factor' | 'macro' | 'sentiment' | 'arb' | 'systematic'

export interface StrategySignal {
  strategyId: string
  symbol: string
  side: 'buy' | 'sell'
  /** Strength [0,1] — how strong the signal is */
  strength: number
  /** Estimated edge in percent (e.g. 0.023 = +2.3% expected) */
  expectedReturn: number
  /** Where this signal should be executed */
  assetClass: string
  metadata?: Record<string, unknown>
}

export interface PipelineResult {
  signal: StrategySignal
  miroFishReport?: SimulationReport
  miroFishScore?: number
  kronosResult?: KronosConfluenceResult
  /** Final decision after all pipeline stages */
  decision: 'execute' | 'reduce' | 'block'
  /** Recommended position size as fraction of available capital [0,1] */
  sizeFraction: number
  /** Final score 0-100 */
  score: number
  blockReason?: string
  auditTrail: string[]
}

/** Tunable-parameter grid: parameter name → candidate values. */
export type ParamGrid = Record<string, number[]>

export abstract class BaseStrategy {
  abstract readonly id: string
  abstract readonly displayName: string
  abstract readonly edgeClassification: EdgeClassification
  abstract readonly defaultBroker: string
  abstract readonly defaultAssetClass: string

  /**
   * Core signal generation — called with recent price bars.
   * Return null if no signal this bar.
   */
  abstract generateSignal(
    symbol: string,
    bars: PriceBar[],
    metadata?: Record<string, unknown>
  ): Promise<StrategySignal | null>

  /** Brier score window (days) for calibration tracking */
  calibrationWindow: number = 90

  /** Minimum bars required to generate a signal */
  minBars: number = 20

  /**
   * Tunable parameters for walk-forward analysis. Strategies that expose a
   * grid get real train-window parameter fitting; strategies returning null
   * degrade to plain out-of-sample splits (train vs test on the same rule).
   */
  paramGrid(): ParamGrid | null {
    return null
  }

  /** Return a NEW instance configured with the given parameters. */
  withParams(_params: Record<string, number>): BaseStrategy {
    return this
  }
}
