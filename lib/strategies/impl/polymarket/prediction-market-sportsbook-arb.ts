/**
 * Prediction Market × Sportsbook Arb — STRUCTURAL
 * Source: TIER 3 T3.8
 * Edge: structural (#edge/structural)
 * Asset: polymarket → Polymarket CLOB
 * AI Confluence: Kronos=skip, MiroFish=skip
 *
 * Identifies sports events where Polymarket YES price + sportsbook implied NO
 * price sums to < 1.0, producing a riskless spread net of fees and vig.
 * Minimum margin: 6% net (PM fee 1.8% + SB vig + 0.5% slippage).
 *
 * REQUIRES PINNACLE_API_KEY. Returns [] without it.
 * WARNING: Resolution criteria must be identical across platforms.
 * Only fires when resolutionCriteriaIdentical() returns true.
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
  sportsbookCancelled,
  isEventResolved,
} from '@/lib/market-data/sportsbook'
import { getMarketDetails, scanTrackedWalletTrades } from '@/lib/market-data/polymarket-wallets'
import { getPortfolioUsd, getRiskControl } from '../../risk-controls'
import { applyEmpiricalHaircuts, zeroSize } from '@/lib/risk/empirical-sizing'
import { randomUUID } from 'crypto'

// ─── Thresholds ────────────────────────────────────────────────────────────────

const MIN_NET_MARGIN   = 0.06    // 6% minimum arbitrage margin
const PM_FEE           = 0.018   // Polymarket taker fee ~1.8%
const SLIPPAGE         = 0.005   // estimated slippage 0.5%
const MIN_DEPTH_USD    = 5_000   // minimum PM liquidity
const TRADE_RISK_PCT   = 0.02    // 2% per trade

// ─── Strategy ─────────────────────────────────────────────────────────────────

export class PredictionMarketSportsbookArbStrategy extends BasePipelineStrategy {
  readonly key = 'prediction_market_sportsbook_arb' as const
  readonly displayName = 'Prediction Market × Sportsbook Arb'
  readonly assetClass = 'polymarket' as const

  async detectOpportunities(ctx: OpportunityContext): Promise<Opportunity[]> {
    if (!process.env.PINNACLE_API_KEY) return []

    const [sbOdds, recentTrades] = await Promise.all([
      getPinnacleOdds(),
      scanTrackedWalletTrades(300),
    ])

    if (sbOdds.length === 0) return []

    // Build list of active PM sports markets from recent trades
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

    const matches = matchEventsAcrossPlatforms(pmMarkets, [], sbOdds)
    const opportunities: Opportunity[] = []

    for (const match of matches) {
      if (!resolutionCriteriaIdentical(match)) continue

      const pmYes      = match.polymarket.yesPrice
      const sbMoneyline = match.sportsbook.moneyline_against
      // Convert American moneyline to implied probability
      const sbNoImplied = sbMoneyline > 0
        ? 100 / (sbMoneyline + 100)
        : Math.abs(sbMoneyline) / (Math.abs(sbMoneyline) + 100)

      const totalCost = pmYes + sbNoImplied
      const margin = 1.0 - totalCost - PM_FEE - match.sportsbook.vig - SLIPPAGE

      if (margin < MIN_NET_MARGIN) continue
      if (match.polymarket.liquidity < MIN_DEPTH_USD) continue

      const maxSizeUsd = Math.min(
        match.polymarket.liquidity * 0.5,
        match.sportsbook.max_bet_size * 0.5,
      )

      const strength = Math.min(1, margin / 0.15)   // 15% margin = full strength
      const expectedReturn = margin

      opportunities.push({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: `POLY:${match.polymarket.market_id}`,
        direction: 'neutral',
        assetClass: this.assetClass,
        strength,
        expectedReturn,
        metadata: {
          eventName: match.event_name,
          eventId: match.event_id,
          pmMarketId: match.polymarket.market_id,
          pmYes,
          sbNoImplied,
          totalCost,
          margin,
          sbPlatform: match.sportsbook.platform,
          sbLeg: { odds: sbMoneyline, platform: match.sportsbook.platform },
          maxSizeUsd,
          reasoning: `PM YES ${pmYes.toFixed(2)} + SB NO ${sbNoImplied.toFixed(2)} = margin ${(margin * 100).toFixed(1)}% on "${match.event_name}"`,
        },
        detectedAt: new Date().toISOString(),
      })
    }

    return opportunities
  }

  async runRedTeam(opp: Opportunity): Promise<RedTeamVerdict> {
    const margin   = (opp.metadata.margin      as number | undefined) ?? 0
    const liquidity = (opp.metadata.maxSizeUsd as number | undefined) ?? 0

    if (margin < MIN_NET_MARGIN) return { passed: false, score: 10, reason: `Margin ${(margin * 100).toFixed(1)}% < 6% threshold` }
    if (liquidity < MIN_DEPTH_USD) return { passed: false, score: 10, reason: `Depth $${liquidity} < $${MIN_DEPTH_USD}` }

    const score = Math.min(100, 40 + margin * 400)
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

    const maxSizeUsd = (opp.metadata.maxSizeUsd as number | undefined) ?? 0
    const structural = Math.min(TRADE_RISK_PCT, maxSinglePct / 100)
    const hc = await applyEmpiricalHaircuts(structural, { supabase, strategyKey: this.key })
    if (hc.blocked) return zeroSize(hc.reason ?? 'maturity blocked')
    const notionalUsd = Math.min(hc.fraction * portfolio, maxSizeUsd)

    return {
      fraction: portfolio > 0 ? notionalUsd / portfolio : 0,
      notionalUsd,
      rationale: `PM/SB arb 2% × empirical haircuts, margin ${((opp.metadata.margin as number) * 100).toFixed(1)}%`,
    }
  }

  async manageOpenPosition(position: OpenPosition, _tick: PriceTick): Promise<ManageAction> {
    const eventId = (position.metadata.eventId as string | undefined) ?? ''
    const sbLeg   = position.metadata.sbLeg

    if (eventId && await isEventResolved(eventId)) {
      return { type: 'close', reason: 'event resolved — collect arbitrage profit' }
    }

    if (sbLeg && await sportsbookCancelled(sbLeg)) {
      return { type: 'close', reason: 'sportsbook leg voided — exit PM side' }
    }

    // Safety timeout: 30 days (sports events rarely last longer)
    const holdDays = (Date.now() - position.openedAt) / 86_400_000
    if (holdDays >= 30) {
      return { type: 'close', reason: '30-day PM/SB arb timeout' }
    }

    return { type: 'hold' }
  }
}
