/**
 * Activist 13D / Insider Cluster — FLOW EDGE
 * Source: TIER 3 T3.1
 * Edge: flow (#edge/flow)
 * Asset: stocks → alpaca
 * AI Confluence: Kronos=skip, MiroFish=medium
 *
 * Signal: 3+ Form 4 purchases by 2+ distinct insiders on the same ticker within
 * 30 days, minimum $100k each, no 10b5-1 plan, executive/director roles only.
 * Skips if a 13D/G activist filing has already been filed (public knowledge).
 * Bracket: -10% stop, +7.72% TP1 (half), trail last half via manageOpenPosition.
 * Hard timeout: 90 days. Exit early if insider sell cluster (2+ execs sell).
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
  fetchForm4Filings,
  search13DG,
  isExecutiveOrBoard,
  has13DG,
} from '@/lib/market-data/sec-edgar'
import { getTickerMeta } from '@/lib/market-data/buyback-scanner'
import { getRiskControl } from '../../risk-controls'
import { computeEmpiricalSize, zeroSize } from '@/lib/risk/empirical-sizing'
import { isAfterMarketClose } from '../../cadence-helpers'
import { randomUUID } from 'crypto'

// ─── Thresholds ────────────────────────────────────────────────────────────────

const MIN_BUY_NOTIONAL    = 100_000     // $100k per individual purchase
const MIN_CLUSTER_BUYS    = 3           // minimum insider purchases in window
const MIN_DISTINCT_BUYERS = 2           // at least 2 different insiders
const WINDOW_DAYS         = 30          // look-back for Form 4 clustering
const MIN_MARKET_CAP      = 500_000_000  // $500M
const MAX_MARKET_CAP      = 50_000_000_000  // $50B
const TRADE_RISK_PCT      = 0.01        // 1% per trade

// ─── Strategy ─────────────────────────────────────────────────────────────────

export class Activist13dInsiderClusterStrategy extends BasePipelineStrategy {
  readonly key = 'activist_13d_insider_cluster' as const
  readonly displayName = 'Activist 13D / Insider Cluster'
  readonly assetClass = 'stocks' as const

  async detectOpportunities(ctx: OpportunityContext): Promise<Opportunity[]> {
    if (!isAfterMarketClose()) return []

    const windowStart = Date.now() - WINDOW_DAYS * 86_400_000
    const filings = await fetchForm4Filings({ after: windowStart, type: 'purchase' })

    // Only executive/director buys above threshold, no 10b5-1 plans
    const qualified = filings.filter(f =>
      isExecutiveOrBoard(f.insider_role) &&
      f.notional_usd >= MIN_BUY_NOTIONAL &&
      !f.is_10b5_1
    )

    // Cluster by ticker
    const byTicker = new Map<string, typeof qualified>()
    for (const f of qualified) {
      if (!byTicker.has(f.ticker)) byTicker.set(f.ticker, [])
      byTicker.get(f.ticker)!.push(f)
    }

    const opportunities: Opportunity[] = []

    for (const [ticker, buys] of byTicker) {
      if (buys.length < MIN_CLUSTER_BUYS) continue
      const distinctBuyers = new Set(buys.map(b => b.insider_id)).size
      if (distinctBuyers < MIN_DISTINCT_BUYERS) continue

      // Skip if 13D already filed (information already public)
      const has13D = await has13DG({ ticker, after: windowStart })
      if (has13D) continue

      const meta = await getTickerMeta(ticker)
      if (!meta) continue
      if (meta.market_cap < MIN_MARKET_CAP || meta.market_cap > MAX_MARKET_CAP) continue

      const totalNotional = buys.reduce((s, b) => s + b.notional_usd, 0)
      const entryPrice = meta.last_close
      const stopPrice  = entryPrice * 0.90     // -10%
      const tp1Price   = entryPrice * 1.0772   // +7.72% (half position)

      const strength = Math.min(1, (buys.length / 5) * (distinctBuyers / 3))
      const expectedReturn = 0.15   // conservative: historical insider cluster avg

      opportunities.push({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: ticker,
        direction: 'long',
        assetClass: this.assetClass,
        strength,
        expectedReturn,
        bracket: { stopPrice, takeProfitPrice: tp1Price },
        metadata: {
          ticker,
          buyCount: buys.length,
          distinctBuyers,
          totalNotionalUsd: totalNotional,
          entryPrice,
          stopPrice,
          tp1Price,
          reasoning: `${buys.length} insider buys ($${(totalNotional / 1000).toFixed(0)}k) by ${distinctBuyers} distinct execs/directors on ${ticker} in ${WINDOW_DAYS}d`,
        },
        detectedAt: new Date().toISOString(),
      })
    }

    return opportunities
  }

  async runRedTeam(opp: Opportunity): Promise<RedTeamVerdict> {
    const buyCount    = (opp.metadata.buyCount     as number | undefined) ?? 0
    const distinct    = (opp.metadata.distinctBuyers as number | undefined) ?? 0
    const totalNotional = (opp.metadata.totalNotionalUsd as number | undefined) ?? 0

    if (buyCount < MIN_CLUSTER_BUYS)    return { passed: false, score: 10, reason: `Only ${buyCount} insider buys (need ${MIN_CLUSTER_BUYS})` }
    if (distinct < MIN_DISTINCT_BUYERS) return { passed: false, score: 10, reason: `Only ${distinct} distinct buyers (need ${MIN_DISTINCT_BUYERS})` }

    const score = Math.min(100, 40 + distinct * 10 + Math.min(20, totalNotional / 50_000))
    return { passed: score >= 40, score, reason: score < 40 ? `Score ${score} below threshold` : undefined }
  }

  async sizePosition(
    opp: Opportunity,
    _verdicts: AllVerdicts,
    userId: string,
    supabase?: SupabaseClient
  ): Promise<PositionSize> {
    const sized = await computeEmpiricalSize({ supabase, userId, strategyKey: this.key, opp })
    if (sized.blocked || sized.portfolioUsd == null) {
      return zeroSize(sized.reason ?? 'refusing to size')
    }
    const rc = supabase ? await getRiskControl(supabase, userId) : undefined
    const maxSinglePct = rc?.max_single_position_pct ?? 10

    const qk = sized.fraction  // empirical Kelly: calibration or maturity floor, never strength
    const fraction = Math.min(qk, TRADE_RISK_PCT, maxSinglePct / 100)
    const notionalUsd = fraction * sized.portfolioUsd

    return {
      fraction,
      notionalUsd,
      rationale: `${sized.rationale}, ${opp.metadata.buyCount} cluster buys`,
    }
  }

  async manageOpenPosition(position: OpenPosition, tick: PriceTick): Promise<ManageAction> {
    const ticker = (position.metadata.ticker as string | undefined) ?? position.symbol

    // Exit if activist 13D filed after our entry
    const filed13D = await has13DG({ ticker, after: position.openedAt })
    if (filed13D) {
      return { type: 'close', reason: '13D activist filing detected — information now public' }
    }

    // Exit on insider sell cluster (2+ executive sales after entry)
    const sells = await fetchForm4Filings({ after: position.openedAt, type: 'sale', ticker })
    const execSells = sells.filter(s => isExecutiveOrBoard(s.insider_role))
    if (execSells.length >= 2) {
      return { type: 'close', reason: `Insider sell cluster: ${execSells.length} exec sales after entry` }
    }

    // Hard timeout: 90 days
    const holdDays = (Date.now() - position.openedAt) / 86_400_000
    if (holdDays >= 90) {
      return { type: 'close', reason: '90-day insider cluster timeout' }
    }

    // Trail last half: once up >7.72% (TP1 hit broker-side), trail at -6%
    const pnlPct = position.entryPrice > 0
      ? (tick.price - position.entryPrice) / position.entryPrice : 0
    if (pnlPct >= 0.0772) {
      const newStop = tick.price * 0.94
      const current = (position.metadata.trailStop as number | undefined) ?? 0
      if (newStop > current) {
        return { type: 'adjustStop', newStop, reason: `Trail stop raised to ${newStop.toFixed(2)}` }
      }
    }

    return { type: 'hold' }
  }
}
