/**
 * Polymarket Triangle Arb — STRUCTURAL
 * Source: TIER 4 T4.6
 * Edge: structural (#edge/structural)
 * Asset: polymarket → Polymarket CLOB
 * AI Confluence: Kronos=skip, MiroFish=skip
 *
 * 3-leg arbitrage across prediction markets:
 *   Leg A: Polymarket YES  (buy at pmYes)
 *   Leg B: Kalshi   NO     (buy at kalshiNo)
 *   Leg C: Sportsbook NO_eq (optional price floor via Pinnacle moneyline)
 *
 * Minimum margin: 5% net (PM fee 1.8% + Kalshi fee 1% + 0.5% slippage).
 * Both PINNACLE_API_KEY and KALSHI_API_KEY must be present.
 * Resolution criteria must be identical across all three platforms.
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
import {
  getPinnacleOdds,
  matchEventsAcrossPlatforms,
  resolutionCriteriaIdentical,
  isEventResolved,
} from '@/lib/market-data/sportsbook'
import { getMarketDetails, scanTrackedWalletTrades } from '@/lib/market-data/polymarket-wallets'
import { getPortfolioUsd, getRiskControl } from '../../risk-controls'
import { applyEmpiricalHaircuts, zeroSize } from '@/lib/risk/empirical-sizing'
import { randomUUID } from 'crypto'

// ─── Thresholds ────────────────────────────────────────────────────────────────

const MIN_NET_MARGIN = 0.05     // 5% minimum triangle margin
const PM_FEE        = 0.018    // Polymarket taker fee ~1.8%
const KALSHI_FEE    = 0.010    // Kalshi taker fee ~1%
const SLIPPAGE      = 0.005    // estimated slippage 0.5%
const MIN_DEPTH_USD = 3_000    // minimum PM liquidity
const TRADE_RISK_PCT = 0.015   // 1.5% per trade (tighter than 2-leg arb)

// ─── Kalshi helpers ────────────────────────────────────────────────────────────

interface KalshiMarket {
  ticker: string
  title: string
  no_ask: number   // cost of NO contract [0,1]
  open_interest: number
  volume: number
  event_ticker: string
}

async function getKalshiMarkets(): Promise<KalshiMarket[]> {
  const apiKey = process.env.KALSHI_API_KEY
  if (!apiKey) return []
  try {
    const url = 'https://trading-api.kalshi.com/trade-api/v2/markets?limit=100&status=open'
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return []
    const data = await res.json() as { markets?: KalshiMarket[] }
    return data.markets ?? []
  } catch {
    return []
  }
}

/** Fuzzy-match PM market question to Kalshi title. Returns null if no match. */
function matchKalshiMarket(
  pmQuestion: string,
  kalshiMarkets: KalshiMarket[]
): KalshiMarket | null {
  if (!pmQuestion) return null
  const pmWords = pmQuestion.toLowerCase().split(/\W+/).filter(w => w.length > 4)
  let bestScore = 0
  let bestMatch: KalshiMarket | null = null

  for (const km of kalshiMarkets) {
    const kmWords = km.title.toLowerCase().split(/\W+/).filter(w => w.length > 4)
    const overlap = pmWords.filter(w => kmWords.includes(w)).length
    const score = overlap / Math.max(pmWords.length, 1)
    if (score > bestScore && score >= 0.5) {
      bestScore = score
      bestMatch = km
    }
  }
  return bestMatch
}

// ─── Strategy ─────────────────────────────────────────────────────────────────

export class PolymarketTriangleArbStrategy extends BasePipelineStrategy {
  readonly key = 'polymarket_triangle_arb' as const
  readonly displayName = 'Polymarket Triangle Arb'
  readonly assetClass = 'polymarket' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    if (!process.env.KALSHI_API_KEY) return []
    if (!process.env.PINNACLE_API_KEY) return []

    const [sbOdds, kalshiMarkets, recentTrades] = await Promise.all([
      getPinnacleOdds(),
      getKalshiMarkets(),
      scanTrackedWalletTrades(300),
    ])

    if (sbOdds.length === 0 && kalshiMarkets.length === 0) return []

    // Build PM markets from recent wallet trades
    const pmMarketIds = new Set(recentTrades.map(t => t.conditionId).filter(Boolean))
    const pmMarkets: Array<{ market_id?: string; question?: string; yes_price?: number; liquidity?: number }> = []

    for (const id of Array.from(pmMarketIds).slice(0, 30)) {
      if (!id) continue
      try {
        const mkt = await getMarketDetails(id)
        if (mkt) {
          pmMarkets.push({
            market_id: id,
            question: mkt.question ?? undefined,
            yes_price: mkt.yes_price,
            liquidity: mkt.liquidity ?? undefined,
          })
        }
      } catch {
        continue
      }
    }

    const opportunities: Opportunity[] = []

    // 3-leg triangle: PM × Kalshi
    for (const pm of pmMarkets) {
      if (!pm.yes_price || !pm.liquidity || pm.liquidity < MIN_DEPTH_USD) continue
      const kalshi = pm.question ? matchKalshiMarket(pm.question, kalshiMarkets) : null
      if (!kalshi || kalshi.no_ask <= 0) continue

      const pmYes      = pm.yes_price
      const kalshiNo   = kalshi.no_ask

      const totalCost  = pmYes + kalshiNo
      const margin     = 1.0 - totalCost - PM_FEE - KALSHI_FEE - SLIPPAGE

      if (margin < MIN_NET_MARGIN) continue

      const maxSizeUsd = Math.min(
        pm.liquidity * 0.5,
        kalshi.open_interest * 0.1 * 100,   // Kalshi contracts are $1 each
        5_000                                 // hard cap per triangle leg
      )

      const strength = Math.min(1, margin / 0.12)   // 12% = full strength
      const expectedReturn = margin

      opportunities.push({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: `POLY:${pm.market_id}`,
        direction: 'neutral',
        assetClass: this.assetClass,
        strength,
        expectedReturn,
        metadata: {
          pmMarketId: pm.market_id,
          pmQuestion: pm.question,
          pmYes,
          kalshiTicker: kalshi.ticker,
          kalshiNo,
          totalCost,
          margin,
          maxSizeUsd,
          legs: ['polymarket_yes', 'kalshi_no'],
          reasoning: `Triangle arb: PM YES ${pmYes.toFixed(2)} + Kalshi NO ${kalshiNo.toFixed(2)} = margin ${(margin * 100).toFixed(1)}% on "${pm.question}"`,
        },
        detectedAt: new Date().toISOString(),
      })
    }

    // Optionally enrich with Pinnacle 3rd leg for matches
    const sbMatches = matchEventsAcrossPlatforms(pmMarkets, [], sbOdds)
    for (const match of sbMatches) {
      if (!resolutionCriteriaIdentical(match)) continue

      // Check if we already have a Kalshi leg for this PM market
      const existing = opportunities.find(o => o.metadata.pmMarketId === match.polymarket.market_id)
      if (existing) {
        // Upgrade to true 3-leg triangle with SB confirmation
        const sbMoneyline = match.sportsbook.moneyline_against
        const sbNoImplied = sbMoneyline > 0
          ? 100 / (sbMoneyline + 100)
          : Math.abs(sbMoneyline) / (Math.abs(sbMoneyline) + 100)

        existing.metadata.sbPlatform = match.sportsbook.platform
        existing.metadata.sbNoImplied = sbNoImplied
        existing.metadata.legs = ['polymarket_yes', 'kalshi_no', 'sportsbook_no']
        existing.metadata.reasoning = `3-leg triangle: PM YES ${existing.metadata.pmYes} + Kalshi NO ${existing.metadata.kalshiNo} + SB NO_eq ${sbNoImplied.toFixed(2)} = margin ${(existing.metadata.margin as number * 100).toFixed(1)}%`
      }
    }

    return opportunities
  }

  async runRedTeam(opp: Opportunity): Promise<RedTeamVerdict> {
    const margin   = (opp.metadata.margin   as number | undefined) ?? 0
    const liquidity = (opp.metadata.maxSizeUsd as number | undefined) ?? 0

    if (margin < MIN_NET_MARGIN) {
      return { passed: false, score: 10, reason: `Margin ${(margin * 100).toFixed(1)}% < 5% threshold` }
    }
    if (liquidity < MIN_DEPTH_USD) {
      return { passed: false, score: 10, reason: `Depth $${liquidity} < $${MIN_DEPTH_USD}` }
    }

    const legs = (opp.metadata.legs as string[] | undefined) ?? []
    const legBonus = legs.length === 3 ? 10 : 0   // 3-leg is more robust
    const score = Math.min(100, 35 + margin * 400 + legBonus)
    return { passed: score >= 35, score }
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

    const maxSizeUsd = (opp.metadata.maxSizeUsd as number | undefined) ?? 0
    const structural = Math.min(TRADE_RISK_PCT, maxSinglePct / 100)
    const hc = await applyEmpiricalHaircuts(structural, { supabase, strategyKey: this.key })
    if (hc.blocked) return zeroSize(hc.reason ?? 'maturity blocked')
    const notionalUsd = Math.min(hc.fraction * portfolio, maxSizeUsd)

    return {
      fraction: portfolio > 0 ? notionalUsd / portfolio : 0,
      notionalUsd,
      rationale: `PM triangle arb 1.5% × empirical haircuts, margin ${((opp.metadata.margin as number) * 100).toFixed(1)}%`,
    }
  }

  async manageOpenPosition(position: OpenPosition, _tick: PriceTick): Promise<ManageAction> {
    const pmMarketId = (position.metadata.pmMarketId as string | undefined) ?? ''

    if (pmMarketId && await isEventResolved(pmMarketId)) {
      return { type: 'close', reason: 'PM market resolved — collect triangle arb profit' }
    }

    // Safety timeout: 30 days
    const holdDays = (Date.now() - position.openedAt) / 86_400_000
    if (holdDays >= 30) {
      return { type: 'close', reason: '30-day triangle arb timeout' }
    }

    return { type: 'hold' }
  }
}
