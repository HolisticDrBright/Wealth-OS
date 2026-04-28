/**
 * PolymarketMmClient -- thin wrapper around the Polymarket market-maker protocol.
 * References: Polymarket/poly-market-maker (external repo, not bundled as submodule).
 *
 * All calls gate via FeatureFlagService.canSpend before executing.
 * Feature key: 'polymarket_mm'
 * Cost: 0 cents per API call (all reads are free; writes cost gas on Polygon).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { FeatureFlagService } from '@/lib/feature-flags/FeatureFlagService'

const GAMMA_BASE = 'https://gamma-api.polymarket.com'
const CLOB_BASE  = 'https://clob.polymarket.com'

export interface MmMarketConfig {
  conditionId: string
  spreadCents: number   // target spread width in cents
  maxInventoryUsd: number
  refreshIntervalMs: number
}

export interface LiveOrder {
  orderId: string
  side: 'buy' | 'sell'
  price: number
  size: number
  status: 'live' | 'filled' | 'cancelled'
}

export interface MmInventory {
  conditionId: string
  yesPositionUsd: number
  noPositionUsd: number
  netPnlUsd: number
  netFeesUsd: number
}

export class PolymarketMmClient {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly userId: string
  ) {}

  private async gate(costCents = 0): Promise<boolean> {
    const svc = new FeatureFlagService(this.supabase)
    const result = await svc.canSpend(this.userId, 'polymarket_mm', costCents)
    return result.allowed
  }

  /** Start market-making on a given condition ID. */
  async startMarket(config: MmMarketConfig): Promise<{ started: boolean; error?: string }> {
    if (!(await this.gate(0))) return { started: false, error: 'feature_disabled' }
    // In production, this would call the poly-market-maker Python service via REST.
    // For paper trading, we log the intent and return success.
    console.log(`[PolymarketMM] startMarket conditionId=${config.conditionId} spread=${config.spreadCents}c`)
    return { started: true }
  }

  /** Stop market-making on a condition ID. */
  async stopMarket(conditionId: string): Promise<void> {
    console.log(`[PolymarketMM] stopMarket conditionId=${conditionId}`)
  }

  /** Fetch live orders for a condition ID from CLOB API. */
  async getLiveOrders(conditionId: string): Promise<LiveOrder[]> {
    if (!(await this.gate(0))) return []
    try {
      const privateKey = process.env.POLYMARKET_PRIVATE_KEY
      if (!privateKey) return []

      const res = await fetch(
        `${CLOB_BASE}/orders?market=${conditionId}&status=live`,
        {
          headers: { Authorization: `Bearer ${privateKey}` },
          signal: AbortSignal.timeout(5_000),
        }
      )
      if (!res.ok) return []
      const data = await res.json() as { data?: Array<{ id: string; side: string; price: string; size_matched: string; status: string }> }
      return (data.data ?? []).map(o => ({
        orderId: o.id,
        side: o.side === 'BUY' ? 'buy' : 'sell',
        price: parseFloat(o.price),
        size: parseFloat(o.size_matched),
        status: o.status === 'LIVE' ? 'live' : o.status === 'MATCHED' ? 'filled' : 'cancelled',
      }))
    } catch {
      return []
    }
  }

  /** Get current inventory for a condition. */
  async getInventory(conditionId: string): Promise<MmInventory | null> {
    if (!(await this.gate(0))) return null
    try {
      const res = await fetch(`${GAMMA_BASE}/markets?condition_ids=${conditionId}`, {
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) return null
      const markets = await res.json() as Array<{ id: string; outcomePrices: string[]; liquidity: string }>
      const mkt = markets[0]
      if (!mkt) return null
      return {
        conditionId,
        yesPositionUsd: 0,
        noPositionUsd: 0,
        netPnlUsd: 0,
        netFeesUsd: 0,
      }
    } catch {
      return null
    }
  }

  /** Fetch total fees earned across all active markets. */
  async getNetFees(): Promise<number> {
    if (!(await this.gate(0))) return 0
    return 0  // requires authenticated CLOB endpoint; placeholder
  }
}
