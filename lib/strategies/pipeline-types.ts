/**
 * Shared types for the strategy pipeline.
 *
 * Flow: detectOpportunities → classifyEdge → runMiroFishConfluence →
 *       runKronosConfluence → runRedTeam → runRiskCheck →
 *       sizePosition → execute → logAudit
 */

import type { StrategyKey, AssetClass, EdgeType } from './strategy-registry'
import type { SimulationReport } from '@/lib/agents/types'

// ─── Core pipeline units ───────────────────────────────────────────────────────

export interface Opportunity {
  id: string
  strategyKey: StrategyKey
  symbol: string
  /** Trade direction the strategy wants to take. */
  direction: 'long' | 'short' | 'neutral'
  assetClass: AssetClass
  /** Signal strength [0, 1]. */
  strength: number
  /** Expected fractional return, e.g. 0.03 = +3%. */
  expectedReturn: number
  metadata: Record<string, unknown>
  detectedAt: string
  /** Optional per-opportunity exit overrides. PaperBroker falls back to
   *  strategy-class defaults when omitted. */
  exit?: {
    stopLossPct?: number
    takeProfitPct?: number
    maxHoldHours?: number
  }
  /**
   * Optional broker-side bracket parameters. When set, BasePipelineStrategy.execute()
   * calls adapter.placeBracketOrder() instead of adapter.execute().
   * stopLossPct and takeProfitPct are fractions of the entry price.
   */
  bracket?: {
    stopLossPct?: number
    stopPrice?: number
    takeProfitPct?: number
    takeProfitPrice?: number
    trailPct?: number
  }
}

export interface OpportunityContext {
  bars?: import('@/lib/backtester').PriceBar[]
  supabase?: import('@supabase/supabase-js').SupabaseClient
  metadata?: Record<string, unknown>
}

// ─── Stage outputs ─────────────────────────────────────────────────────────────

export interface PipelineEdgeClassification {
  edgeType: EdgeType
  confidence: number
  rationale: string
}

export interface MiroFishVerdict {
  scenario: 'bull' | 'bear' | 'neutral'
  /** Simulation score [0, 100]. */
  score: number
  report: SimulationReport
  costCents: number
  used: boolean
}

export interface KronosVerdict {
  skew: 'bullish' | 'bearish' | 'neutral'
  skewStrength: number
  pass: boolean
  reason: string
  used: boolean
}

export interface RedTeamVerdict {
  passed: boolean
  /** Composite score [0, 100]. */
  score: number
  reason?: string
}

export interface RiskVerdict {
  veto: boolean
  reason?: string
  /** Kelly-optimal fraction of capital [0, 1]. */
  kellyFraction: number
}

export interface AllVerdicts {
  mirofish: MiroFishVerdict | null
  kronos: KronosVerdict | null
  redTeam: RedTeamVerdict
  risk: RiskVerdict
}

export interface PositionSize {
  /** Fraction of total capital [0, 1]. */
  fraction: number
  notionalUsd: number
  rationale: string
  /** Multiplier applied to strategy stop-loss distance. Sourced from user risk profile. */
  stopLossMultiplier?: number
}

export interface ExecutionResult {
  status: 'submitted' | 'skipped' | 'failed'
  broker: string
  brokerOrderId?: string
  error?: string
}

export interface Decision {
  action: 'execute' | 'reduce_size' | 'block'
  reason?: string
  size?: PositionSize
}

// ─── Position Monitor types ────────────────────────────────────────────────────

/** Snapshot of an open paper or live position passed to manageOpenPosition(). */
export interface OpenPosition {
  id: string
  strategyKey: string
  symbol: string
  assetClass: AssetClass
  direction: 'long' | 'short' | 'neutral'
  entryPrice: number
  currentPrice: number
  quantity: number
  notionalUsd: number
  stopLossPct: number
  takeProfitPct: number
  maxHoldHours: number
  /** Unix ms timestamp of when the position was opened. */
  openedAt: number
  metadata: Record<string, unknown>
  /** Broker-side order IDs for cancellation/modification. */
  bracketIds?: {
    parentOrderId?: string
    stopOrderId?: string
    takeProfitOrderId?: string
  }
}

/** A single price tick from a market data feed or polling loop. */
export interface PriceTick {
  symbol: string
  price: number
  timestamp: number
  bid?: number
  ask?: number
  volume?: number
}

/**
 * Action returned by manageOpenPosition(). Broker-side stops handle static exits;
 * this covers dynamic adjustments the position monitor must execute.
 */
export type ManageAction =
  | { type: 'hold' }
  | { type: 'close'; reason: string }
  | { type: 'adjustStop'; newStop: number; reason: string }
  | { type: 'adjustTarget'; newTarget: number; reason: string }
