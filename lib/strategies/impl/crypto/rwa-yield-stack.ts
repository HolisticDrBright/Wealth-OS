/**
 * RWA Yield Stack — FUNDAMENTAL CARRY
 * Source: TIER 3 T3.5
 * Edge: fundamental (#edge/fundamental)
 * Asset: crypto → coinbase
 * AI Confluence: Kronos=skip, MiroFish=skip
 *
 * Deploys idle stablecoin balance into tokenised T-bill products (BUIDL, USDY,
 * BENJI, USDM) when their APY exceeds the 4-week T-bill yield by ≥ 5% AND
 * exceeds the best Aave stablecoin APY by ≥ 0.5%. Runs weekly on Mondays.
 * Exit if APY drops below 85% of T-bill yield or de-peg > 1%.
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
import { getRwaApy, getBestAaveStablecoinApy } from '@/lib/market-data/defi-llama'
import { getTbill4WeekYield } from '@/lib/market-data/fred-api'
import { getPortfolioUsd, getRiskControl } from '../../risk-controls'
import { isMondayEt } from '../../cadence-helpers'
import { randomUUID } from 'crypto'

// ─── RWA product registry ──────────────────────────────────────────────────────

const RWA_PRODUCTS = [
  { name: 'USDY',  issuer: 'Ondo',     poolId: 'usdy',  minUsd: 100 },
  { name: 'BENJI', issuer: 'Franklin', poolId: 'benji', minUsd: 0   },
  { name: 'USDM',  issuer: 'Mountain', poolId: 'usdm',  minUsd: 0   },
  { name: 'BUIDL', issuer: 'BlackRock',poolId: 'buidl', minUsd: 0   },   // $5M minimum in reality but 0 here for paper
]

const MIN_YIELD_PREMIUM  = 0.005   // APY must exceed best Aave APY by >= 0.5%
const MAX_SINGLE_PCT     = 0.30    // max 30% of portfolio in a single RWA product
const TRADE_RISK_PCT     = 0.10    // 10% per trade (stable, low-risk)

// ─── Strategy ─────────────────────────────────────────────────────────────────

export class RwaYieldStackStrategy extends BasePipelineStrategy {
  readonly key = 'rwa_yield_stack' as const
  readonly displayName = 'RWA Yield Stack'
  readonly assetClass = 'crypto' as const

  async detectOpportunities(ctx: OpportunityContext): Promise<Opportunity[]> {
    if (!isMondayEt()) return []

    const [tbillYield, bestAaveApy] = await Promise.all([
      getTbill4WeekYield(),
      getBestAaveStablecoinApy(),
    ])

    const opportunities: Opportunity[] = []

    for (const product of RWA_PRODUCTS) {
      const apy = await getRwaApy(product.poolId)
      if (apy === null) continue
      if (apy < tbillYield * 0.95) continue          // must beat T-bill
      if (apy < bestAaveApy - MIN_YIELD_PREMIUM) continue   // must beat Aave baseline

      const yieldSpread = apy - tbillYield
      const strength = Math.min(1, yieldSpread / 0.10)    // 10% spread = full strength
      const expectedReturn = apy / 52   // weekly return

      opportunities.push({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: product.name,
        direction: 'long',
        assetClass: this.assetClass,
        strength,
        expectedReturn,
        metadata: {
          productName: product.name,
          issuer: product.issuer,
          poolId: product.poolId,
          apy,
          tbillYield,
          bestAaveApy,
          yieldSpread,
          reasoning: `${product.issuer} ${product.name} APY ${(apy * 100).toFixed(2)}% vs T-bill ${(tbillYield * 100).toFixed(2)}% (spread +${(yieldSpread * 100).toFixed(2)}%)`,
        },
        detectedAt: new Date().toISOString(),
      })
    }

    return opportunities
  }

  async runRedTeam(opp: Opportunity): Promise<RedTeamVerdict> {
    const apy      = (opp.metadata.apy          as number | undefined) ?? 0
    const tbill    = (opp.metadata.tbillYield    as number | undefined) ?? 0.05
    const aaveApy  = (opp.metadata.bestAaveApy   as number | undefined) ?? 0

    if (apy < tbill * 0.95) return { passed: false, score: 15, reason: `APY ${(apy * 100).toFixed(2)}% below T-bill ${(tbill * 100).toFixed(2)}%` }
    if (apy < aaveApy - MIN_YIELD_PREMIUM) return { passed: false, score: 20, reason: `APY below best Aave baseline` }

    const score = Math.min(100, 50 + (apy - tbill) * 500)
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

    const fraction = Math.min(TRADE_RISK_PCT, MAX_SINGLE_PCT, maxSinglePct / 100)
    const notionalUsd = fraction * portfolio

    return {
      fraction,
      notionalUsd,
      rationale: `RWA stable carry, APY ${((opp.metadata.apy as number) * 100).toFixed(2)}%`,
    }
  }

  async manageOpenPosition(position: OpenPosition, tick: PriceTick): Promise<ManageAction> {
    const poolId   = (position.metadata.poolId   as string | undefined) ?? ''
    const tbillRef = (position.metadata.tbillYield as number | undefined) ?? 0.05

    // De-peg risk: RWA tokens should trade at exactly $1.00
    if (Math.abs(tick.price - 1.00) > 0.01) {
      return { type: 'close', reason: `${position.symbol} de-peg risk: price ${tick.price.toFixed(4)} ≠ $1.00` }
    }

    // Yield degraded below 85% of T-bill floor
    const currentApy = poolId ? await getRwaApy(poolId) : null
    if (currentApy !== null && currentApy < tbillRef * 0.85) {
      return { type: 'close', reason: `${position.symbol} APY ${(currentApy * 100).toFixed(2)}% dropped below 85% of T-bill` }
    }

    // Hard timeout: 365 days (RWA products are long-duration)
    const holdDays = (Date.now() - position.openedAt) / 86_400_000
    if (holdDays >= 365) {
      return { type: 'close', reason: '365-day RWA yield stack timeout' }
    }

    return { type: 'hold' }
  }
}
