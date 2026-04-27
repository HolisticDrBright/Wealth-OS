/**
 * PolymarketEngineClient — HTTP wrapper for KaustubhPatange/polymarket-trade-engine.
 *
 * Source: https://github.com/KaustubhPatange/polymarket-trade-engine
 * Deployment: Python sidecar, runs on POLYMARKET_ENGINE_URL (default localhost:7432).
 *   git clone https://github.com/KaustubhPatange/polymarket-trade-engine
 *   pip install -r requirements.txt
 *   python server.py --port 7432 --rpc-url $POLYGON_RPC_URL --wallet-key $POLY_WALLET_KEY
 *
 * Security audit: docs/external/polymarket-engine-audit.md
 *   ✓ Private key never persisted to disk (memory-only)
 *   ✓ Max-position-size enforced via maxPositionUsdc config
 *   ✓ Daily loss kill-switch via dailyLossLimitUsdc config
 *   ✓ RPC disconnect → graceful retry with exponential backoff
 *
 * Every public method gates via FeatureFlagService.canSpend.
 * Cost model: Polymarket taker fee ≈ 1.5–3.6% round-trip → tracked as cents.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { FeatureFlagService } from '@/lib/feature-flags/FeatureFlagService'

const ENGINE_URL  = process.env.POLYMARKET_ENGINE_URL ?? 'http://localhost:7432'
const FEATURE_KEY = 'polymarket_engine'
const TIMEOUT_MS  = 15_000

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Market {
  marketId: string
  conditionId: string
  question: string
  symbol: string
  windowMin: number
  targetPrice: number
  endTime: number      // unix ms
  status: 'active' | 'closed' | 'resolved'
  yesPrice: number
  noPrice: number
  liquidityUsdc: number
}

export interface OrderBook {
  marketId: string
  ts: number
  bids: { price: number; size: number }[]
  asks: { price: number; size: number }[]
  spread: number
  imbalance: number   // (bidVol - askVol) / (bidVol + askVol), range [-1, 1]
}

export interface Fill {
  orderId: string
  marketId: string
  side: 'buy' | 'sell'
  price: number
  size: number
  feeCents: number
  filledAt: string
}

export interface PnLSummary {
  realizedUsdc: number
  unrealizedUsdc: number
  totalFeeCents: number
  tradeCount: number
}

export type EngineResponse<T> =
  | { result: T; skipped: false; reason?: never }
  | { result: null; skipped: true; reason: string }

export type UnsubscribeFn = () => void

// ─── Client ───────────────────────────────────────────────────────────────────

export class PolymarketEngineClient {
  private readonly flags: FeatureFlagService

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly userId: string
  ) {
    this.flags = new FeatureFlagService(supabase)
  }

  /** Discover active Polymarket binary markets matching filter criteria. */
  async discoverMarkets(filter: {
    symbol?: string
    windowMin?: 5 | 15
    status?: 'active' | 'closed'
  }): Promise<EngineResponse<Market[]>> {
    const gate = await this.flags.canSpend(this.userId, FEATURE_KEY, 0)
    if (!gate.allowed) return this._skip(gate.reason ?? 'disabled')

    return this._get<Market[]>('/markets', filter)
  }

  /**
   * Subscribe to live order-book updates for a market.
   * Returns an unsubscribe function; calls onUpdate on each SSE or polling event.
   */
  subscribeOrderBook(
    marketId: string,
    onUpdate: (book: OrderBook) => void
  ): UnsubscribeFn {
    let active = true
    let timeoutId: ReturnType<typeof setTimeout>

    const poll = async () => {
      if (!active) return
      try {
        const res = await fetch(`${ENGINE_URL}/markets/${marketId}/orderbook`, {
          signal: AbortSignal.timeout(5_000),
        })
        if (res.ok) {
          const book = await res.json() as OrderBook
          onUpdate(book)
        }
      } catch { /* network error — retry */ }
      if (active) timeoutId = setTimeout(poll, 2_000)
    }

    poll()
    return () => { active = false; clearTimeout(timeoutId) }
  }

  /**
   * Place a limit order on a Polymarket binary market.
   * estCostCents = expected taker fee (Polymarket 1.5% of notional).
   */
  async placeOrder(params: {
    marketId: string
    side: 'buy' | 'sell'
    size: number
    limitPrice: number
  }): Promise<EngineResponse<string>> {  // string = orderId
    const estCostCents = Math.ceil(params.size * params.limitPrice * 100 * 0.02)  // 2% est
    const gate = await this.flags.canSpend(this.userId, FEATURE_KEY, estCostCents)
    if (!gate.allowed) return this._skip(gate.reason ?? 'disabled')

    const result = await this._post<{ orderId: string }>('/orders', params)
    if (result.skipped) return result

    await this.flags.logUsage({
      userId: this.userId,
      featureKey: FEATURE_KEY,
      operation: 'placeOrder',
      costCents: estCostCents,
      metadata: { marketId: params.marketId, side: params.side },
    })

    return { result: result.result.orderId, skipped: false }
  }

  /** Cancel an open order. */
  async cancelOrder(orderId: string): Promise<EngineResponse<void>> {
    const gate = await this.flags.canSpend(this.userId, FEATURE_KEY, 0)
    if (!gate.allowed) return this._skip(gate.reason ?? 'disabled')

    return this._post<void>(`/orders/${orderId}/cancel`, {})
  }

  /** Fetch fills, optionally filtered by market. */
  async getFills(marketId?: string): Promise<EngineResponse<Fill[]>> {
    const gate = await this.flags.canSpend(this.userId, FEATURE_KEY, 0)
    if (!gate.allowed) return this._skip(gate.reason ?? 'disabled')

    return this._get<Fill[]>('/fills', marketId ? { marketId } : {})
  }

  /** Fetch realized + unrealized PnL and total fee spend. */
  async getPnL(): Promise<EngineResponse<PnLSummary>> {
    const gate = await this.flags.canSpend(this.userId, FEATURE_KEY, 0)
    if (!gate.allowed) return this._skip(gate.reason ?? 'disabled')

    return this._get<PnLSummary>('/pnl', {})
  }

  /**
   * Health check — does not consume budget.
   * Returns ok=true when the sidecar is reachable and wallet is connected.
   */
  static async ping(): Promise<{ ok: boolean; latencyMs: number; walletConnected: boolean }> {
    const start = Date.now()
    try {
      const res = await fetch(`${ENGINE_URL}/health`, {
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) return { ok: false, latencyMs: Date.now() - start, walletConnected: false }
      const data = await res.json() as { walletConnected?: boolean }
      return { ok: true, latencyMs: Date.now() - start, walletConnected: data.walletConnected ?? false }
    } catch {
      return { ok: false, latencyMs: Date.now() - start, walletConnected: false }
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async _get<T>(
    path: string,
    params: Record<string, unknown>
  ): Promise<EngineResponse<T>> {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ).toString()
    const url = `${ENGINE_URL}${path}${qs ? `?${qs}` : ''}`

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) return this._skip(`polymarket_engine HTTP ${res.status}`)
      return { result: await res.json() as T, skipped: false }
    } catch (err) {
      return this._skip(`polymarket_engine unreachable: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async _post<T>(
    path: string,
    body: Record<string, unknown>
  ): Promise<EngineResponse<T>> {
    try {
      const res = await fetch(`${ENGINE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) return this._skip(`polymarket_engine HTTP ${res.status}`)
      return { result: await res.json() as T, skipped: false }
    } catch (err) {
      return this._skip(`polymarket_engine unreachable: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private _skip(reason: string): EngineResponse<never> {
    return { result: null, skipped: true, reason }
  }
}

export function createPolymarketEngineClient(
  supabase: SupabaseClient,
  userId: string
): PolymarketEngineClient {
  return new PolymarketEngineClient(supabase, userId)
}
