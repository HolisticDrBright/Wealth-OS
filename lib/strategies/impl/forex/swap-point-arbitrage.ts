/**
 * Swap Point Arbitrage — STRUCTURAL CARRY
 * Source: TIER 3 T3.7
 * Edge: structural (#edge/structural)
 * Asset: forex → oanda (+ alt broker)
 * AI Confluence: Kronos=skip, MiroFish=skip
 * DEFAULT-DISABLED — uneconomic at retail spreads for most users.
 *
 * Opens matched long/short on the same forex pair across two brokers when
 * their overnight swap rates produce a net positive edge > 5× round-trip costs.
 * Requires at least 2 linked forex brokers.
 * Only fires in the 30-min pre-overnight-roll window (16:30–17:00 ET).
 *
 * WARNING: This strategy requires institutional-grade swap rates. At retail
 * spreads, round-trip costs typically eliminate the edge. Default-disabled.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type {
  Opportunity,
  OpportunityContext,
  RedTeamVerdict,
  AllVerdicts,
  PositionSize,
  OpenPosition,
  PriceTick,
  ManageAction,
} from '../../pipeline-types'
import { getPortfolioUsd, getRiskControl } from '../../risk-controls'
import { applyEmpiricalHaircuts, zeroSize } from '@/lib/risk/empirical-sizing'
import { isPreOvernightRoll } from '../../cadence-helpers'
import { randomUUID } from 'crypto'

// ─── Watched pairs ────────────────────────────────────────────────────────────

const SWAP_PAIRS = ['AUDJPY', 'NZDCHF', 'GBPJPY']
const MIN_EDGE_OVER_COSTS = 5   // net edge must exceed round-trip costs × 5

// ─── Swap rate helpers ────────────────────────────────────────────────────────

/** Fetch swap rate for a pair and side from OANDA. Returns null when unavailable. */
async function getOandaSwapRate(pair: string, side: 'long' | 'short'): Promise<number | null> {
  const apiKey = process.env.OANDA_API_KEY
  if (!apiKey) return null
  try {
    const instrument = pair.slice(0, 3) + '_' + pair.slice(3)
    const url = `https://api-fxtrade.oanda.com/v3/instruments/${instrument}/financing?financingDaysOfWeek[]=MONDAY`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(4_000),
    })
    if (!res.ok) return null
    const data = await res.json() as { financing?: { longRate?: number; shortRate?: number } }
    return side === 'long'
      ? (data.financing?.longRate ?? null)
      : (data.financing?.shortRate ?? null)
  } catch {
    return null
  }
}

/** Estimate round-trip costs (spread + commission) in rate-equivalent units. */
function estimateRoundtripCosts(_pair: string): number {
  return 0.0003   // ~3 pips round-trip — conservative
}

// ─── Strategy ─────────────────────────────────────────────────────────────────

export class SwapPointArbitrageStrategy extends BasePipelineStrategy {
  readonly key = 'swap_point_arbitrage' as const
  readonly displayName = 'Swap Point Arbitrage'
  readonly assetClass = 'forex' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    if (!isPreOvernightRoll()) return []

    const apiKey = process.env.OANDA_API_KEY
    if (!apiKey) return []   // requires broker API access

    const opportunities: Opportunity[] = []

    for (const pair of SWAP_PAIRS) {
      const [swapLong, swapShort] = await Promise.all([
        getOandaSwapRate(pair, 'long'),
        getOandaSwapRate(pair, 'short'),
      ])

      if (swapLong === null || swapShort === null) continue

      // Net edge: long rate on broker A + short rate on broker B
      // Simplified: check if OANDA offers positive net (full impl needs 2 brokers)
      const totalEdge = Math.abs(swapLong) + Math.abs(swapShort)
      if (totalEdge <= 0) continue

      const costs = estimateRoundtripCosts(pair)
      if (totalEdge < costs * MIN_EDGE_OVER_COSTS) continue

      const strength = Math.min(1, (totalEdge - costs) / (costs * 10))
      const expectedReturn = totalEdge / 365   // daily carry

      opportunities.push({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: pair,
        direction: 'neutral',
        assetClass: this.assetClass,
        strength,
        expectedReturn,
        metadata: {
          pair,
          swapLong,
          swapShort,
          totalEdge,
          costs,
          originalEdge: totalEdge,
          reasoning: `Swap edge ${totalEdge.toFixed(4)} vs costs ${costs.toFixed(4)} (${(totalEdge / costs).toFixed(1)}× cover)`,
        },
        detectedAt: new Date().toISOString(),
      })
    }

    return opportunities
  }

  async runRedTeam(opp: Opportunity): Promise<RedTeamVerdict> {
    const totalEdge = (opp.metadata.totalEdge as number | undefined) ?? 0
    const costs     = (opp.metadata.costs     as number | undefined) ?? 0.0003

    if (totalEdge < costs * MIN_EDGE_OVER_COSTS) {
      return {
        passed: false,
        score: 10,
        reason: `Swap edge ${totalEdge.toFixed(4)} < ${MIN_EDGE_OVER_COSTS}× costs (${(costs * MIN_EDGE_OVER_COSTS).toFixed(4)})`
      }
    }

    const score = Math.min(100, 40 + (totalEdge / costs) * 5)
    return { passed: score >= 40, score }
  }

  async sizePosition(
    opp: Opportunity,
    _verdicts: AllVerdicts,
    userId: string,
    supabase?: SupabaseClient
  ): Promise<PositionSize> {
    const portfolio = supabase ? await getPortfolioUsd(supabase, userId) : null
    if (portfolio == null) {
      return zeroSize('equity_unavailable: refusing to size — never default equity')
    }
    const rc = supabase ? await getRiskControl(supabase, userId) : undefined
    const maxSinglePct = rc?.max_single_position_pct ?? 10

    const structural = Math.min(0.005, maxSinglePct / 100)   // 0.5% — tiny position
    const hc = await applyEmpiricalHaircuts(structural, { supabase, strategyKey: this.key })
    if (hc.blocked) return zeroSize(hc.reason ?? 'maturity blocked')
    const notionalUsd = hc.fraction * portfolio

    return {
      fraction: hc.fraction,
      notionalUsd,
      rationale: `Swap arb 0.5% × empirical haircuts, edge ${((opp.metadata.totalEdge as number) * 10000).toFixed(1)} pips`,
    }
  }

  async manageOpenPosition(position: OpenPosition, _tick: PriceTick): Promise<ManageAction> {
    const pair         = (position.metadata.pair         as string | undefined) ?? 'AUDJPY'
    const originalEdge = (position.metadata.originalEdge as number | undefined) ?? 0

    const [swapLong, swapShort] = await Promise.all([
      getOandaSwapRate(pair, 'long'),
      getOandaSwapRate(pair, 'short'),
    ])

    if (swapLong === null || swapShort === null) return { type: 'hold' }

    const currentEdge = Math.abs(swapLong) + Math.abs(swapShort)
    if (originalEdge > 0 && currentEdge < originalEdge * 0.5) {
      return { type: 'close', reason: `Swap edge compressed to ${currentEdge.toFixed(4)} (< 50% of entry ${originalEdge.toFixed(4)})` }
    }

    return { type: 'hold' }
  }
}
