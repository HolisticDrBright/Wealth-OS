/**
 * Crucix On-Chain Whale Aggregator Client
 *
 * Wraps the Crucix API for Polygon-native whale wallet movement tracking.
 * Used as an alternative/comparison source for polymarket_wallet_copy and
 * onchain_signal whale sub-signals.
 *
 * Evaluation: docs/external/crucix-evaluation.md
 * Feature flag: 'crucix' (free tier, $0 per call)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { FeatureFlagService } from '@/lib/feature-flags/FeatureFlagService'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WhaleMovement {
  walletAddress: string
  chain: 'polygon' | 'ethereum' | 'arbitrum' | 'base'
  token: string
  symbol: string
  direction: 'inflow' | 'outflow'
  amountUsd: number
  txHash: string
  blockNumber: number
  timestamp: string
  label: string | null       // e.g. 'Polymarket LP', 'Known MEV', 'CEX Hot Wallet'
  isKnownActor: boolean
}

export interface WhaleSignal {
  symbol: string
  netFlowUsd: number          // positive = more inflows than outflows
  inflowCount: number
  outflowCount: number
  largestSingleMove: number
  dominantDirection: 'inflow' | 'outflow' | 'neutral'
  windowHours: number
  sampledAt: string
}

export interface CrucixResponse<T> {
  result: T
  skipped: boolean
  reason?: string
  dataProvider: 'crucix'
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class CrucixClient {
  private readonly baseUrl: string
  private readonly apiKey: string | null
  private readonly svc: FeatureFlagService
  private readonly userId: string

  constructor(supabase: SupabaseClient, userId: string) {
    this.baseUrl = process.env.CRUCIX_API_URL ?? 'https://api.crucix.io/v1'
    this.apiKey = process.env.CRUCIX_API_KEY ?? null
    this.svc = new FeatureFlagService(supabase)
    this.userId = userId
  }

  private get headers() {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) h['X-API-Key'] = this.apiKey
    return h
  }

  /**
   * Get recent large whale movements for a token symbol on Polygon.
   * minAmountUsd: only return moves above this threshold (default $50k).
   */
  async getWhaleMovements(
    symbol: string,
    windowHours = 24,
    minAmountUsd = 50_000
  ): Promise<CrucixResponse<WhaleMovement[]>> {
    const gate = await this.svc.canSpend(this.userId, 'crucix', 0)
    if (!gate.allowed) return { result: [], skipped: true, reason: gate.reason, dataProvider: 'crucix' }

    try {
      const url = new URL(`${this.baseUrl}/whale-movements`)
      url.searchParams.set('symbol', symbol)
      url.searchParams.set('window_hours', String(windowHours))
      url.searchParams.set('min_amount_usd', String(minAmountUsd))
      url.searchParams.set('chain', 'polygon')

      const res = await fetch(url.toString(), {
        headers: this.headers,
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) return { result: [], skipped: true, reason: `HTTP ${res.status}`, dataProvider: 'crucix' }
      const data = await res.json() as WhaleMovement[]
      return { result: data, skipped: false, dataProvider: 'crucix' }
    } catch {
      return { result: [], skipped: true, reason: 'crucix API unreachable', dataProvider: 'crucix' }
    }
  }

  /**
   * Aggregate whale flow into a net signal for a symbol.
   * Useful for onchain_signal and polymarket_wallet_copy whale sub-signal.
   */
  async getWhaleSignal(symbol: string, windowHours = 24): Promise<CrucixResponse<WhaleSignal | null>> {
    const movementsRes = await this.getWhaleMovements(symbol, windowHours)
    if (movementsRes.skipped || movementsRes.result.length === 0) {
      return { result: null, skipped: movementsRes.skipped, reason: movementsRes.reason, dataProvider: 'crucix' }
    }

    const moves = movementsRes.result
    const inflows  = moves.filter(m => m.direction === 'inflow')
    const outflows = moves.filter(m => m.direction === 'outflow')
    const netFlowUsd = inflows.reduce((s, m) => s + m.amountUsd, 0)
                     - outflows.reduce((s, m) => s + m.amountUsd, 0)
    const largest = Math.max(...moves.map(m => m.amountUsd))

    const dominantDirection: WhaleSignal['dominantDirection'] =
      netFlowUsd > 100_000 ? 'inflow'
      : netFlowUsd < -100_000 ? 'outflow'
      : 'neutral'

    return {
      result: {
        symbol,
        netFlowUsd,
        inflowCount: inflows.length,
        outflowCount: outflows.length,
        largestSingleMove: largest,
        dominantDirection,
        windowHours,
        sampledAt: new Date().toISOString(),
      },
      skipped: false,
      dataProvider: 'crucix',
    }
  }

  /** Check API reachability and label coverage. */
  static async ping(): Promise<{ ok: boolean; latencyMs: number; labelCoverage?: number }> {
    const url = process.env.CRUCIX_API_URL ?? 'https://api.crucix.io/v1'
    const start = Date.now()
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3_000) })
      if (!res.ok) return { ok: false, latencyMs: Date.now() - start }
      const data = await res.json() as { label_coverage_pct?: number }
      return { ok: true, latencyMs: Date.now() - start, labelCoverage: data.label_coverage_pct }
    } catch {
      return { ok: false, latencyMs: Date.now() - start }
    }
  }
}
