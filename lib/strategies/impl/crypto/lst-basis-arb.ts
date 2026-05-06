/**
 * LST Basis Arb — STRUCTURAL CARRY
 * Source: TIER 3 T3.4
 * Edge: structural (#edge/structural)
 * Asset: crypto → coinbase
 * AI Confluence: Kronos=skip, MiroFish=skip
 *
 * Buys stETH / rETH / cbETH when the LST trades at a discount to fair value
 * (> 0.5% discount) and the Lido withdrawal queue is < 30 days. Exit when the
 * LST reaches par (LST/ETH ratio ≥ fair ratio) or after 14 days.
 *
 * Size: 5% of portfolio (structural carry, low volatility).
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
  getLstPoolPrice,
  getWithdrawalQueueDays,
  getAccumulatedYieldRatio,
} from '@/lib/market-data/lido-protocol'
import { getPortfolioUsd, getRiskControl } from '../../risk-controls'
import { randomUUID } from 'crypto'

// ─── LST pool definitions ─────────────────────────────────────────────────────

const LST_POOLS = [
  { lstSymbol: 'stETH', maxQueueDays: 30 },
  { lstSymbol: 'rETH',  maxQueueDays: 30 },
  { lstSymbol: 'cbETH', maxQueueDays: 30 },
]

const MIN_DISCOUNT_PCT = 0.005   // 0.5% minimum discount to act
const TRADE_RISK_PCT   = 0.05   // 5% of portfolio

// ─── Strategy ─────────────────────────────────────────────────────────────────

export class LstBasisArbStrategy extends BasePipelineStrategy {
  readonly key = 'lst_basis_arb' as const
  readonly displayName = 'LST Basis Arb'
  readonly assetClass = 'crypto' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    const queueDays = await getWithdrawalQueueDays()
    const opportunities: Opportunity[] = []

    for (const pool of LST_POOLS) {
      if (queueDays > pool.maxQueueDays) continue

      const lst = await getLstPoolPrice(pool.lstSymbol)
      if (!lst) continue
      if (lst.discountPct < MIN_DISCOUNT_PCT) continue

      const strength = Math.min(1, lst.discountPct / 0.02)   // 2% discount = full strength
      const expectedReturn = lst.discountPct   // conservative: just close the gap

      opportunities.push({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: `${pool.lstSymbol}-USD`,
        direction: 'long',
        assetClass: this.assetClass,
        strength,
        expectedReturn,
        bracket: {
          stopPrice: lst.lstPriceUsd * 0.97,   // -3% stop
          takeProfitPrice: lst.lstPriceUsd * (1 + lst.discountPct),  // target: par
        },
        metadata: {
          lstSymbol: pool.lstSymbol,
          lstPriceUsd: lst.lstPriceUsd,
          ethPriceUsd: lst.ethPriceUsd,
          fairRatio: lst.fairRatio,
          discountPct: lst.discountPct,
          queueDays,
          reasoning: `${pool.lstSymbol} trading at ${(lst.discountPct * 100).toFixed(2)}% discount to fair value. Queue: ${queueDays.toFixed(0)}d.`,
        },
        detectedAt: new Date().toISOString(),
      })
    }

    return opportunities
  }

  async runRedTeam(opp: Opportunity): Promise<RedTeamVerdict> {
    const discount = (opp.metadata.discountPct as number | undefined) ?? 0
    const queue    = (opp.metadata.queueDays   as number | undefined) ?? 999

    if (discount < MIN_DISCOUNT_PCT) return { passed: false, score: 10, reason: `Discount ${(discount * 100).toFixed(2)}% below ${MIN_DISCOUNT_PCT * 100}% threshold` }
    if (queue > 30) return { passed: false, score: 10, reason: `Withdrawal queue ${queue.toFixed(0)}d > 30d` }

    const score = Math.min(100, 40 + discount * 2000 + (30 - queue))
    return { passed: score >= 40, score }
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

    const fraction = Math.min(TRADE_RISK_PCT, maxSinglePct / 100)
    const notionalUsd = fraction * portfolio

    return {
      fraction,
      notionalUsd,
      rationale: `5% structural LST basis, ${((opp.metadata.discountPct as number) * 100).toFixed(2)}% discount`,
    }
  }

  async manageOpenPosition(position: OpenPosition, tick: PriceTick): Promise<ManageAction> {
    const lst = (position.metadata.lstSymbol as string | undefined) ?? 'stETH'

    const fairRatio = await getAccumulatedYieldRatio(lst)
    const ethPriceUsd = (position.metadata.ethPriceUsd as number | undefined) ?? 0
    const targetPrice = ethPriceUsd > 0 ? ethPriceUsd * fairRatio : 0

    // Exit when at or above fair value
    if (targetPrice > 0 && tick.price >= targetPrice) {
      return { type: 'close', reason: `${lst} reached par (price ${tick.price.toFixed(2)} >= target ${targetPrice.toFixed(2)})` }
    }

    const holdDays = (Date.now() - position.openedAt) / 86_400_000
    if (holdDays >= 14) {
      return { type: 'close', reason: '14-day LST basis arb timeout' }
    }

    return { type: 'hold' }
  }
}
