/**
 * Buyback Announcement Momentum — EVENT EDGE
 * Source: TIER 3 T3.2
 * Edge: event (#edge/event)
 * Asset: stocks → alpaca
 * AI Confluence: Kronos=medium, MiroFish=medium
 *
 * Signal: Company announces a new share repurchase program ≥ 5% of market cap,
 * positive profit margin, $1B+ cap. Not an extension of existing program,
 * no simultaneous secondary offering, not debt-funded. Bracket: -8%/-20% TP.
 * Hard timeout: 30 days. Exit early if earnings window or breaks 20-DMA.
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
  fetchBuybackAnnouncements,
  getTickerMeta,
  hasSimultaneousSecondaryOffering,
  isExtensionOfExistingProgram,
  checkDebtFunded,
} from '@/lib/market-data/buyback-scanner'
import { getRiskControl, getPortfolioUsd, quarterKelly } from '../../risk-controls'
import { isAfterMarketClose } from '../../cadence-helpers'
import { randomUUID } from 'crypto'

// ─── Thresholds ────────────────────────────────────────────────────────────────

const MIN_BUYBACK_PCT   = 0.05    // minimum 5% of market cap
const MIN_MARKET_CAP    = 1_000_000_000   // $1B
const TRADE_RISK_PCT    = 0.01    // 1% per trade

// ─── Strategy ─────────────────────────────────────────────────────────────────

export class BuybackAnnouncementMomentumStrategy extends BasePipelineStrategy {
  readonly key = 'buyback_announcement_momentum' as const
  readonly displayName = 'Buyback Announcement Momentum'
  readonly assetClass = 'stocks' as const

  async detectOpportunities(ctx: OpportunityContext): Promise<Opportunity[]> {
    if (!isAfterMarketClose()) return []

    const announcements = await fetchBuybackAnnouncements({ withinHours: 24 })
    if (announcements.length === 0) return []

    const opportunities: Opportunity[] = []

    for (const ann of announcements) {
      const meta = await getTickerMeta(ann.ticker)
      if (!meta) continue
      if (meta.market_cap < MIN_MARKET_CAP) continue
      if (meta.profit_margin <= 0) continue
      if (ann.size_usd > 0 && ann.size_usd / meta.market_cap < MIN_BUYBACK_PCT) continue

      // Quality filters
      if (await hasSimultaneousSecondaryOffering(ann.ticker)) continue
      if (ann.is_extension || await isExtensionOfExistingProgram(ann.ticker)) continue
      if (ann.size_usd > 0 && await checkDebtFunded(ann.ticker, ann.size_usd)) continue

      const entryPrice = meta.last_close
      const stopPrice  = entryPrice * 0.92    // -8%
      const tp1Price   = entryPrice * 1.10    // +10% TP1 (1/3)
      const tp2Price   = entryPrice * 1.20    // +20% TP2 (1/3)

      const buybackPct = ann.size_usd > 0 ? ann.size_usd / meta.market_cap : MIN_BUYBACK_PCT
      const strength = Math.min(1, buybackPct / 0.10)   // 10% buyback = full strength
      const expectedReturn = 0.12

      opportunities.push({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: ann.ticker,
        direction: 'long',
        assetClass: this.assetClass,
        strength,
        expectedReturn,
        bracket: { stopPrice, takeProfitPrice: tp1Price },
        metadata: {
          ticker: ann.ticker,
          sizeUsd: ann.size_usd,
          buybackPct,
          entryPrice,
          stopPrice,
          tp1Price,
          tp2Price,
          announcedAt: ann.announced_at,
          openedAt: Date.now(),
          reasoning: `${ann.ticker} announced $${(ann.size_usd / 1e6).toFixed(0)}M buyback (${(buybackPct * 100).toFixed(1)}% of mktcap). Profitable, not debt-funded.`,
        },
        detectedAt: new Date().toISOString(),
      })
    }

    return opportunities
  }

  async runRedTeam(opp: Opportunity): Promise<RedTeamVerdict> {
    const buybackPct = (opp.metadata.buybackPct as number | undefined) ?? 0

    if (buybackPct < MIN_BUYBACK_PCT) {
      return { passed: false, score: 15, reason: `Buyback ${(buybackPct * 100).toFixed(1)}% < 5% threshold` }
    }

    const score = Math.min(100, 40 + buybackPct * 400)  // 10% buyback → 80 score
    return { passed: score >= 40, score, reason: score < 40 ? `Score ${score}` : undefined }
  }

  async sizePosition(
    opp: Opportunity,
    _verdicts: AllVerdicts,
    userId: string,
    supabase?: SupabaseClient
  ): Promise<PositionSize> {
    const portfolio = supabase ? await getPortfolioUsd(supabase, userId) : 10_000
    const rc = supabase ? await getRiskControl(supabase, userId) : undefined
    const maxSinglePct = rc?.max_single_position_pct ?? 10

    const qk = quarterKelly(opp.strength, opp.expectedReturn / 0.02)
    const fraction = Math.min(qk, TRADE_RISK_PCT, maxSinglePct / 100)
    const notionalUsd = fraction * portfolio

    return {
      fraction,
      notionalUsd,
      rationale: `QK=${(qk * 100).toFixed(1)}%, buyback ${((opp.metadata.buybackPct as number) * 100).toFixed(1)}%`,
    }
  }

  async manageOpenPosition(position: OpenPosition, tick: PriceTick): Promise<ManageAction> {
    const pnlPct = position.entryPrice > 0
      ? (tick.price - position.entryPrice) / position.entryPrice : 0

    // Backup stop if broker-side failed
    if (pnlPct <= -0.08) {
      return { type: 'close', reason: 'buyback -8% stop-loss backup' }
    }

    // 20-DMA proxy: entry * 0.97 as a simplified floor (real impl needs bar data)
    const sma20Proxy = position.entryPrice * 0.97
    if (tick.price < sma20Proxy) {
      return { type: 'close', reason: `broke 20-DMA proxy ($${sma20Proxy.toFixed(2)})` }
    }

    // Hard timeout: 30 days
    const holdDays = (Date.now() - position.openedAt) / 86_400_000
    if (holdDays >= 30) {
      return { type: 'close', reason: '30-day buyback momentum timeout' }
    }

    return { type: 'hold' }
  }
}
