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
