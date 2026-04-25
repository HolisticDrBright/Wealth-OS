/**
 * VibeTradingClient — wrapper for the Vibe-Trading (HKUDS) MCP server.
 *
 * Connects to the MCP server via HTTP transport and exposes typed methods for
 * the 17 available tools. 16 of 17 tools require zero API keys.
 *
 * All methods:
 *   - Gate through FeatureFlagService.canSpend
 *   - Return { result, skipped, reason } — callers never need to handle
 *     the "disabled" case explicitly
 *   - Apply a 30-second timeout with graceful null fallback
 *
 * Source: https://github.com/HKUDS/Vibe-Trading
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { FeatureFlagService } from '@/lib/feature-flags/FeatureFlagService'

const VIBE_URL = process.env.VIBE_TRADING_MCP_URL ?? 'http://localhost:8765'
const FEATURE_KEY = 'vibe_trading'
const TOOL_COST_CENTS = 0   // free tools (LLM token cost logged separately when applicable)
const TIMEOUT_MS = 30_000

// ─── Public return shape ──────────────────────────────────────────────────────

export type VibeTradingResponse<T> =
  | { result: T; skipped: false; reason?: never }
  | { result: null; skipped: true; reason: string }

// ─── Tool-specific input/output types ────────────────────────────────────────

export interface BacktestInput {
  strategy_code: string
  symbol: string
  start_date: string   // YYYY-MM-DD
  end_date: string
  initial_capital?: number
}

export interface BacktestOutput {
  total_return_pct: number
  annualized_return_pct: number
  sharpe_ratio: number
  max_drawdown_pct: number
  win_rate_pct: number
  trade_count: number
  equity_curve: { date: string; value: number }[]
}

export interface FactorAnalysisInput {
  symbols: string[]
  factors?: ('momentum' | 'value' | 'quality' | 'size' | 'volatility' | 'profitability')[]
  lookback_days?: number
}

export interface FactorAnalysisOutput {
  symbol: string
  factor_scores: Record<string, number>
  composite_score: number
  rank: number
  recommendation: 'overweight' | 'neutral' | 'underweight'
}

export interface PatternRecognitionInput {
  symbol: string
  timeframe?: '1d' | '1h' | '4h'
  pattern_types?: ('vcp' | 'cup_handle' | 'breakout' | 'flag' | 'wedge' | 'head_shoulders')[]
}

export interface PatternRecognitionOutput {
  patterns_found: {
    pattern: string
    confidence: number
    target_price?: number
    stop_loss?: number
    breakout_level?: number
  }[]
  overall_signal: 'bullish' | 'bearish' | 'neutral'
  signal_strength: number
}

export interface AnalyzeOptionsInput {
  symbol: string
  expiry_date?: string
  strategy?: 'wheel' | 'covered_call' | 'cash_secured_put' | 'iron_condor' | 'strangle'
  target_delta?: number
}

export interface AnalyzeOptionsOutput {
  recommended_strike: number
  expiry: string
  premium_usd: number
  annualized_yield_pct: number
  delta: number
  theta_daily: number
  probability_of_profit: number
  breakeven_price: number
  max_loss_usd: number
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class VibeTradingClient {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly userId: string
  ) {}

  /** Run a strategy backtest using Vibe-Trading's backtesting engine. */
  async backtest(input: BacktestInput): Promise<VibeTradingResponse<BacktestOutput>> {
    return this._callTool<BacktestOutput>('backtest', input)
  }

  /** Multi-factor score a list of symbols (free, no key required). */
  async factorAnalysis(input: FactorAnalysisInput): Promise<VibeTradingResponse<FactorAnalysisOutput[]>> {
    return this._callTool<FactorAnalysisOutput[]>('factor_analysis', input)
  }

  /** Detect chart patterns in a symbol's price history. */
  async patternRecognition(input: PatternRecognitionInput): Promise<VibeTradingResponse<PatternRecognitionOutput>> {
    return this._callTool<PatternRecognitionOutput>('pattern_recognition', input)
  }

  /** Analyze options strategies for a given symbol. */
  async analyzeOptions(input: AnalyzeOptionsInput): Promise<VibeTradingResponse<AnalyzeOptionsOutput>> {
    return this._callTool<AnalyzeOptionsOutput>('analyze_options', input)
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private async _callTool<T>(
    tool: string,
    params: Record<string, unknown>
  ): Promise<VibeTradingResponse<T>> {
    const svc = new FeatureFlagService(this.supabase)
    const gate = await svc.canSpend(this.userId, FEATURE_KEY, TOOL_COST_CENTS)

    if (!gate.allowed) {
      return {
        result: null,
        skipped: true,
        reason: gate.reason === 'disabled'
          ? 'vibe_trading feature disabled'
          : `vibe_trading budget exhausted (${gate.reason})`,
      }
    }

    try {
      const res = await fetch(`${VIBE_URL}/tools/${tool}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (!res.ok) {
        return { result: null, skipped: true, reason: `vibe_trading HTTP ${res.status}` }
      }

      const data = await res.json() as T
      return { result: data, skipped: false }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[VibeTradingClient] tool=${tool} error: ${msg}`)
      return { result: null, skipped: true, reason: `vibe_trading unreachable: ${msg}` }
    }
  }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

export function createVibeTradingClient(
  supabase: SupabaseClient,
  userId: string
): VibeTradingClient {
  return new VibeTradingClient(supabase, userId)
}
