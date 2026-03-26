import type { Asset, Goal, Trader } from '@/lib/types'

export interface TradeContext {
  trade: {
    id?: string
    symbol: string
    action: 'buy' | 'sell' | 'short' | 'cover'
    asset_class: 'stock' | 'crypto' | 'forex' | 'polymarket'
    notional_value: number
    trader_name: string
    trader_handle: string
    trader_return_pct: number
    trader_win_rate: number
    trade_date?: string
  }
  user: {
    id: string
    total_net_worth: number
    portfolio: Asset[]
    goals?: Goal[]
    risk_profile?: 'conservative' | 'moderate' | 'aggressive'
    max_allocation_pct?: number
  }
}

export type AgentRecommendation = 'approve' | 'reduce' | 'reject' | 'defer'
export type ConfidenceLevel = 'high' | 'medium' | 'low'

export interface AgentOutput {
  agent: string
  recommendation: AgentRecommendation
  confidence: ConfidenceLevel
  score: number // 0-100
  reasoning: string
  keyPoints: string[]
  metadata?: Record<string, unknown>
}

export interface SimulationReport {
  jobId: string
  reportId: string
  bullProbability: number      // 0-1
  bearProbability: number      // 0-1
  consensusDirection: 'bullish' | 'bearish' | 'neutral'
  tailRiskScore: number        // 0-100, higher = more tail risk
  confidenceLevel: ConfidenceLevel
  agentConsensus: number       // 0-1, fraction of agents agreeing
  keyFindings: string[]
  scenarioSummary: string
  rawReport?: string
}

export interface CIODecision {
  decision: 'execute' | 'reduce' | 'defer' | 'reject'
  reasoning: string
  investmentCommitteeView: string
  portfolioImpact: string
  positionSizing: {
    recommended_pct: number
    max_pct: number
    rationale: string
  }
  accountPlacement: string
  timing: string
  riskFactors: string[]
  confidence: ConfidenceLevel
  plainEnglishSummary: string
  agentScores: Record<string, number>
  agentOutputs: AgentOutput[]
  miroFishScore?: number
  finalScore: number // 0-100
}
