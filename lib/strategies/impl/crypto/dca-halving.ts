/**
 * DCA Halving — CYCLE ACCUMULATOR
 * Source: wealth-os-vault/03 - Crypto/DCA Halving.md
 * Edge: onchain (#edge/onchain)
 * Asset: crypto → Coinbase
 * AI Confluence: Kronos=medium, MiroFish=medium
 *
 * Buys BTC/ETH on dips during accumulation and contraction phases of the
 * 4-year halving cycle. Signal fires when:
 *   1. Cycle phase is accumulation (year 1) or contraction (year 4 pre-halving)
 *   2. Price is ≥ 15% below the 90-day high (buy-the-dip trigger)
 *   3. MVRV Z-score < 3.5 (not overvalued; Glassnode if key set, else skipped)
 *
 * Weekly DCA base: even without a dip trigger, accumulation phase allows
 * a weekly base buy at 0.25% of portfolio.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type {
  Opportunity,
  OpportunityContext,
  RedTeamVerdict,
  AllVerdicts,
  PositionSize,
} from '../../pipeline-types'
import { getRiskControl, getPortfolioUsd, quarterKelly, applyConfluenceHaircut } from '../../risk-controls'
import { getHalvingCycleState, getDCASignal } from '@/lib/market-data/halving'
import type { HalvingPhase } from '@/lib/market-data/halving'
import { randomUUID } from 'crypto'

// ─── Thresholds (per vault recipe) ────────────────────────────────────────────

const DIP_THRESHOLD         = 0.15   // ≥ 15% below 90d high to trigger dip buy
const MVRV_OVERBOUGHT       = 3.5    // MVRV Z-score above this → no new buys
const TRADE_RISK_PCT        = 0.01   // 1% per trade (accumulation phase)
const WEEKLY_DCA_PCT        = 0.0025 // 0.25% weekly base DCA
const EXPANSION_RISK_PCT    = 0.005  // halve risk in expansion phase
const DISTRIBUTION_BLOCK    = true   // block new buys in distribution

// ─── Price data ───────────────────────────────────────────────────────────────

interface OhlcBar { close: number }

/**
 * Fetch BTC 90-day OHLC from CoinGecko public API (no key required).
 * Returns { currentPrice, ninetyDayHigh } or null on failure.
 */
async function getBtcPriceStats(): Promise<{ currentPrice: number; ninetyDayHigh: number } | null> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=90&interval=daily',
      { signal: AbortSignal.timeout(6_000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    const prices: [number, number][] = data.prices ?? []
    if (prices.length === 0) return null

    const closes = prices.map(([, p]) => p)
    const currentPrice   = closes[closes.length - 1]
    const ninetyDayHigh  = Math.max(...closes)
    return { currentPrice, ninetyDayHigh }
  } catch {
    return null
  }
}

async function getEthPriceStats(): Promise<{ currentPrice: number; ninetyDayHigh: number } | null> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=90&interval=daily',
      { signal: AbortSignal.timeout(6_000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    const prices: [number, number][] = data.prices ?? []
    if (prices.length === 0) return null

    const closes = prices.map(([, p]) => p)
    return { currentPrice: closes[closes.length - 1], ninetyDayHigh: Math.max(...closes) }
  } catch {
    return null
  }
}

// ─── MVRV Z-score (Glassnode, gated) ─────────────────────────────────────────

/**
 * Fetch MVRV Z-score from Glassnode if API key is set.
 * Returns null (don't block) if Glassnode is unavailable.
 */
async function getMvrvZScore(): Promise<number | null> {
  const key = process.env.GLASSNODE_API_KEY
  if (!key) return null

  try {
    const res = await fetch(
      `https://api.glassnode.com/v1/metrics/market/mvrv_z_score?a=BTC&api_key=${key}`,
      { signal: AbortSignal.timeout(8_000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    const last = data[data.length - 1]
    return (last?.v as number | undefined) ?? null
  } catch {
    return null
  }
}

// ─── Weekly DCA gate ──────────────────────────────────────────────────────────

/** True if last DCA buy for the symbol was more than 7 days ago (or never). */
async function isWeeklyDcaDue(
  supabase: SupabaseClient | undefined,
  userId: string,
  symbol: string
): Promise<boolean> {
  if (!supabase) return true
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from('user_copied_positions')
    .select('opened_at')
    .eq('user_id', userId)
    .eq('asset_class', 'crypto')
    .like('broker_override_reason', `%dca_halving%${symbol}%`)
    .gte('opened_at', since)
    .limit(1)
  return !data || data.length === 0
}

// ─── Phase risk multiplier ────────────────────────────────────────────────────

function phaseRiskMultiplier(phase: HalvingPhase): number {
  switch (phase) {
    case 'accumulation': return 1.0
    case 'contraction':  return 0.8   // build position but cautiously
    case 'expansion':    return 0.5   // half size — let momentum run
    case 'distribution': return 0.0   // no new buys
  }
}

// ─── Strategy ─────────────────────────────────────────────────────────────────

export class DcaHalvingStrategy extends BasePipelineStrategy {
  readonly key = 'dca_halving' as const
  readonly displayName = 'DCA Halving'
  readonly assetClass = 'crypto' as const

  async detectOpportunities(ctx: OpportunityContext): Promise<Opportunity[]> {
    const opportunities: Opportunity[] = []
    const cycleState = getHalvingCycleState()
    const { phase, daysSinceHalving, daysToNextHalving, cycleProgressPct } = cycleState

    // Block new buys in distribution phase entirely
    if (phase === 'distribution' && DISTRIBUTION_BLOCK) return []

    // Fetch MVRV — if available and overbought, block
    const mvrv = await getMvrvZScore()
    if (mvrv !== null && mvrv > MVRV_OVERBOUGHT) return []

    const phaseMultiplier = phaseRiskMultiplier(phase)
    if (phaseMultiplier === 0) return []

    // Process BTC and ETH
    const assets: Array<{ id: string; label: string; fetchFn: () => Promise<{ currentPrice: number; ninetyDayHigh: number } | null> }> = [
      { id: 'BTC',  label: 'Bitcoin',  fetchFn: getBtcPriceStats },
      { id: 'ETH',  label: 'Ethereum', fetchFn: getEthPriceStats },
    ]

    for (const asset of assets) {
      const priceData = await asset.fetchFn()
      if (!priceData) continue

      const { currentPrice, ninetyDayHigh } = priceData
      const dipSignal = getDCASignal(currentPrice, ninetyDayHigh, DIP_THRESHOLD)

      // DIP BUY: strong signal when dip threshold met
      if (dipSignal.signal === 'buy') {
        const strength = Math.min(1, dipSignal.strength * phaseMultiplier)
        const dipPct   = (ninetyDayHigh - currentPrice) / ninetyDayHigh

        opportunities.push({
          id: randomUUID(),
          strategyKey: this.key,
          symbol: asset.id,
          direction: 'long',
          assetClass: this.assetClass,
          strength,
          expectedReturn: dipPct * 0.5,  // expect to recover 50% of the dip
          metadata: {
            asset: asset.id,
            currentPrice,
            ninetyDayHigh,
            dipPct,
            phase,
            daysSinceHalving,
            daysToNextHalving,
            cycleProgressPct,
            mvrvZScore: mvrv,
            triggerType: 'dip_buy',
            reason: dipSignal.reason,
            reasoning: `${asset.label} ${phase} phase — ${(dipPct * 100).toFixed(1)}% dip from 90d high. ${dipSignal.reason}`,
          },
          detectedAt: new Date().toISOString(),
        })

      } else if (dipSignal.signal === 'reduce') {
        // Distribution-phase trimming (we allowed through above check)
        opportunities.push({
          id: randomUUID(),
          strategyKey: this.key,
          symbol: asset.id,
          direction: 'short',  // reduce = sell signal
          assetClass: this.assetClass,
          strength: 0.4,
          expectedReturn: 0.02,
          metadata: {
            asset: asset.id,
            currentPrice,
            ninetyDayHigh,
            phase,
            triggerType: 'distribution_trim',
            reason: dipSignal.reason,
            reasoning: `${asset.label} near 90d high in ${phase} phase — trimming position. ${dipSignal.reason}`,
          },
          detectedAt: new Date().toISOString(),
        })

      } else if (phase === 'accumulation' || phase === 'contraction') {
        // WEEKLY DCA BASE: accumulate even without a dip trigger
        const isDue = await isWeeklyDcaDue(ctx.supabase, ctx.metadata?.userId as string ?? 'anon', asset.id)
        if (isDue) {
          opportunities.push({
            id: randomUUID(),
            strategyKey: this.key,
            symbol: asset.id,
            direction: 'long',
            assetClass: this.assetClass,
            strength: 0.25 * phaseMultiplier,  // low strength = small position
            expectedReturn: 0.04,
            metadata: {
              asset: asset.id,
              currentPrice,
              ninetyDayHigh,
              phase,
              daysSinceHalving,
              mvrvZScore: mvrv,
              triggerType: 'weekly_dca',
              reasoning: `${asset.label} weekly DCA base — ${phase} phase (${daysSinceHalving}d since halving). No dip threshold met but regular accumulation.`,
            },
            detectedAt: new Date().toISOString(),
          })
        }
      }
    }

    return opportunities
  }

  async runRedTeam(opp: Opportunity): Promise<RedTeamVerdict> {
    const phase       = opp.metadata.phase as HalvingPhase
    const triggerType = opp.metadata.triggerType as string | undefined
    const mvrv        = opp.metadata.mvrvZScore as number | null | undefined

    // Block distribution buys (shouldn't reach here but safety check)
    if (phase === 'distribution' && opp.direction === 'long') {
      return { passed: false, score: 10, reason: 'No new longs in distribution phase' }
    }

    // Block if MVRV overbought
    if (mvrv !== null && mvrv !== undefined && mvrv > MVRV_OVERBOUGHT) {
      return { passed: false, score: 15, reason: `MVRV Z-score ${mvrv.toFixed(2)} > ${MVRV_OVERBOUGHT} — market overvalued` }
    }

    // Weekly DCA is inherently low-conviction — score it lower
    if (triggerType === 'weekly_dca' && opp.strength < 0.20) {
      return { passed: true, score: 45, reason: undefined }  // just barely passes
    }

    const baseScore = Math.min(100, opp.strength * 80 + (phase === 'accumulation' ? 10 : 0))

    // Opposing case: cycle timing might be wrong — 30% haircut for cycle uncertainty
    const adjustedScore = baseScore * 0.70

    return {
      passed: adjustedScore >= 35,
      score: adjustedScore,
      reason: adjustedScore < 35
        ? `Cycle risk too high: phase=${phase}, strength=${opp.strength.toFixed(2)}, score=${adjustedScore.toFixed(0)}`
        : undefined,
    }
  }

  async sizePosition(
    opp: Opportunity,
    verdicts: AllVerdicts,
    userId: string,
    supabase?: SupabaseClient
  ): Promise<PositionSize> {
    const portfolio = supabase ? await getPortfolioUsd(supabase, userId) : 10_000
    const rc = supabase ? await getRiskControl(supabase, userId) : undefined
    const maxSinglePct = rc?.max_single_position_pct ?? 10

    const phase = opp.metadata.phase as HalvingPhase
    const trigger = opp.metadata.triggerType as string | undefined
    const phaseMultiplier = phaseRiskMultiplier(phase)

    // Weekly DCA base: fixed 0.25% regardless of Kelly
    if (trigger === 'weekly_dca') {
      const fraction = Math.min(WEEKLY_DCA_PCT * phaseMultiplier, maxSinglePct / 100)
      return {
        fraction,
        notionalUsd: fraction * portfolio,
        rationale: `Weekly DCA base — ${phase} phase, ${(fraction * 100).toFixed(2)}% fixed`,
      }
    }

    // Dip buy: quarter-Kelly based on expected recovery
    const riskPct = (phase === 'expansion' ? EXPANSION_RISK_PCT : TRADE_RISK_PCT) * phaseMultiplier
    const qk = quarterKelly(opp.strength, opp.expectedReturn / 0.02)
    let fraction = Math.min(qk, riskPct, maxSinglePct / 100)
    fraction = applyConfluenceHaircut(fraction, verdicts.mirofish?.score ?? null, verdicts.kronos?.pass ?? null)
    fraction = Math.max(fraction, 0.003)

    const notionalUsd = fraction * portfolio
    return {
      fraction,
      notionalUsd,
      rationale: `QK=${(qk * 100).toFixed(1)}% dip-buy, phase=${phase}, dip=${((opp.metadata.dipPct as number | undefined ?? 0) * 100).toFixed(1)}%`,
    }
  }
}
