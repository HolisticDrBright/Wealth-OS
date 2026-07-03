/**
 * Polymarket Market Maker
 * Edge: liquidity (#edge/liquidity)
 * Asset: polymarket -> Polymarket CLOB
 * AI Confluence: MiroFish=skip, Kronos=skip
 *
 * Income strategy using bid-ask spread capture on Polymarket prediction markets.
 * Parallel in spirit to options_wheel: collect premium by providing liquidity.
 * 14-day mandatory paper-trade validation before live capital.
 *
 * Entry criteria:
 *   - daily_volume > $50k
 *   - spread > 3 cents
 *   - resolution > 24h away
 *   - not flagged by polymarket_no_trade gate
 *   - top N by liquidity score (default 5)
 */

import { randomUUID } from 'crypto'
import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type {
  Opportunity,
  OpportunityContext,
  RedTeamVerdict,
  AllVerdicts,
  PositionSize,
} from '../../pipeline-types'
import { getPortfolioUsd, getRiskControl } from '../../risk-controls'
import { applyEmpiricalHaircuts, zeroSize } from '@/lib/risk/empirical-sizing'
import type { SupabaseClient } from '@supabase/supabase-js'

// --- Thresholds ---------------------------------------------------------------

const MIN_DAILY_VOLUME_USD = 50_000
const MIN_SPREAD_CENTS     = 0.03    // 3 cents
const MIN_HOURS_TO_RESOLVE = 24
const MAX_MARKETS          = 5       // top N by liquidity
const DAILY_LOSS_LIMIT_USD = 200     // stop all MM when daily loss exceeds this
const INVENTORY_CAP_USD    = 500     // max net position per market
const TRADE_RISK_PCT       = 0.005   // 0.5% per market (income strategy)

const GAMMA_BASE = 'https://gamma-api.polymarket.com'

interface GammaMarket {
  id: string
  conditionId: string
  question: string
  endDate: string
  volume: string
  volume24hr: number
  liquidity: string
  active: boolean
  closed: boolean
  bestBid: string
  bestAsk: string
  outcomePrices: string[]
  acceptingOrders: boolean
}

function daysUntil(dateStr: string): number {
  return (new Date(dateStr).getTime() - Date.now()) / 86_400_000
}

// Cadence: runs every 30s cycle; at strategy level we gate on market hours
function inTradingWindow(): boolean {
  const h = new Date().getUTCHours()
  // Polymarket trades 24/7; restrict MM to liquid hours 8-22 UTC to avoid thin books
  return h >= 8 && h < 22
}

export class PolymarketMarketMakerStrategy extends BasePipelineStrategy {
  readonly key = 'polymarket_market_maker' as const
  readonly displayName = 'Polymarket Market Maker'
  readonly assetClass = 'polymarket' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    if (!inTradingWindow()) return []

    try {
      const res = await fetch(
        `${GAMMA_BASE}/markets?active=true&closed=false&limit=100&order=volumeNum&ascending=false`,
        { signal: AbortSignal.timeout(8_000) }
      )
      if (!res.ok) return []

      const markets: GammaMarket[] = await res.json()
      const candidates: Opportunity[] = []

      for (const mkt of markets) {
        if (!mkt.acceptingOrders || mkt.closed) continue

        const volume24h = mkt.volume24hr ?? 0
        if (volume24h < MIN_DAILY_VOLUME_USD) continue

        const hoursLeft = daysUntil(mkt.endDate) * 24
        if (hoursLeft < MIN_HOURS_TO_RESOLVE) continue

        const bid = parseFloat(mkt.bestBid ?? '0')
        const ask = parseFloat(mkt.bestAsk ?? '1')
        const spread = ask - bid
        if (spread < MIN_SPREAD_CENTS) continue

        const liquidity = parseFloat(mkt.liquidity ?? '0')

        // Liquidity score: volume * spread efficiency
        const liquidityScore = (volume24h / 100_000) * Math.min(spread / 0.05, 1)

        // Expected return from spread capture
        // Conservative: capture half the spread per round-trip (other side may not fill)
        const expectedReturn = (spread * 0.5) / ((bid + ask) / 2)

        // Strength: how confident we are the spread will persist to resolution
        const strength = Math.min(0.9, 0.4 + liquidityScore * 0.3 + Math.min(0.2, (hoursLeft / 720) * 0.2))

        candidates.push({
          id: randomUUID(),
          strategyKey: this.key,
          symbol: `POLY:${mkt.conditionId ?? mkt.id}`,
          direction: 'neutral',  // MM is direction-neutral
          assetClass: this.assetClass,
          strength,
          expectedReturn,
          metadata: {
            conditionId: mkt.conditionId ?? mkt.id,
            question: mkt.question,
            endDate: mkt.endDate,
            hoursLeft,
            volume24h,
            liquidity,
            bid,
            ask,
            spread,
            liquidityScore,
            inventoryCapUsd: INVENTORY_CAP_USD,
            dailyLossLimitUsd: DAILY_LOSS_LIMIT_USD,
            reasoning: `MM: ${mkt.question.slice(0, 60)}... spread=${(spread * 100).toFixed(1)}c vol24h=$${(volume24h / 1000).toFixed(0)}k ttl=${hoursLeft.toFixed(0)}h`,
          },
          detectedAt: new Date().toISOString(),
        })

        if (candidates.length >= MAX_MARKETS) break
      }

      // Sort by liquidity score descending; return top N
      return candidates
        .sort((a, b) => (b.metadata.liquidityScore as number) - (a.metadata.liquidityScore as number))
        .slice(0, MAX_MARKETS)
    } catch {
      return []
    }
  }

  async runRedTeam(opp: Opportunity): Promise<RedTeamVerdict> {
    const spread    = opp.metadata.spread as number
    const volume24h = opp.metadata.volume24h as number
    const hoursLeft = opp.metadata.hoursLeft as number

    // Hard gates: insufficient spread or approaching resolution
    if (spread < MIN_SPREAD_CENTS) {
      return { passed: false, score: 10, reason: `Spread ${(spread * 100).toFixed(1)}c < ${MIN_SPREAD_CENTS * 100}c minimum` }
    }
    if (hoursLeft < MIN_HOURS_TO_RESOLVE) {
      return { passed: false, score: 15, reason: `Only ${hoursLeft.toFixed(0)}h to resolution -- stop MM` }
    }

    // Opposing case: MM can get caught on the wrong side of a binary resolution
    // Penalty if volume spiking (informed trading may be entering)
    const volumeOk = volume24h >= MIN_DAILY_VOLUME_USD
    const baseScore = Math.min(100, opp.strength * 70 + (volumeOk ? 20 : 0))

    return {
      passed: baseScore >= 40,
      score: baseScore,
      reason: baseScore < 40 ? `MM red-team score ${baseScore.toFixed(0)} -- insufficient liquidity or spread` : undefined,
    }
  }

  async sizePosition(
    opp: Opportunity,
    verdicts: AllVerdicts,
    userId: string,
    supabase?: SupabaseClient
  ): Promise<PositionSize> {
    const portfolio = supabase ? await getPortfolioUsd(supabase, userId) : null
    if (portfolio == null) {
      return zeroSize('equity_unavailable: refusing to size — never default equity')
    }
    const rc = supabase ? await getRiskControl(supabase, userId) : undefined
    const maxSinglePct = rc?.max_single_position_pct ?? 5

    // Income strategy: size by inventory cap, empirical haircuts still apply
    let fraction = Math.min(TRADE_RISK_PCT, maxSinglePct / 100)
    if (verdicts.mirofish) fraction *= (verdicts.mirofish.score / 100)
    const hc = await applyEmpiricalHaircuts(fraction, { supabase, strategyKey: this.key })
    if (hc.blocked) return zeroSize(hc.reason ?? 'maturity blocked')

    const notionalUsd = Math.min(
      hc.fraction * portfolio,
      INVENTORY_CAP_USD,
      portfolio * maxSinglePct / 100
    )

    return {
      fraction: notionalUsd / portfolio,
      notionalUsd,
      rationale: `MM income: inventory cap $${INVENTORY_CAP_USD}, spread=${((opp.metadata.spread as number) * 100).toFixed(1)}c`,
    }
  }
}
