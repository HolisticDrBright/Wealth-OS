/**
 * Funding Basis Arb — STRUCTURAL CARRY
 * Source: wealth-os-vault/03 - Crypto/Funding Basis Arb.md
 * Edge: structural (#edge/structural)
 * Asset: crypto → binance_us (perp) + coinbase (spot)
 * AI Confluence: Kronos=skip, MiroFish=skip
 *
 * Delta-neutral strategy: long spot + short perp when funding rate is elevated.
 * Earns the funding rate differential while remaining market-neutral.
 *
 * Fetches live funding rates from Deribit → Binance (via funding-rates.ts).
 * Position cap: 25% of top-of-book depth on the weaker leg.
 * Roll logic: skips new entries within 30 min of funding settlement.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type {
  Opportunity,
  OpportunityContext,
  RedTeamVerdict,
  AllVerdicts,
  PositionSize,
  ExecutionResult,
  OpenPosition,
  PriceTick,
  ManageAction,
} from '../../pipeline-types'
import { getRiskControl, getPortfolioUsd, quarterKelly } from '../../risk-controls'
import { getFundingRate } from '@/lib/market-data/funding-rates'
import type { BrokerCache } from '@/lib/brokers/BrokerFactory'
import { selectBroker } from '@/lib/brokers/asset-broker-routing'
import { getBroker } from '@/lib/brokers/BrokerFactory'
import { randomUUID } from 'crypto'

// ─── Thresholds (per vault recipe) ────────────────────────────────────────────

const HIGH_FUNDING_THRESHOLD  = 0.0002    // 0.02%/8h = ~9% annualised
const MIN_SPREAD_BPS          = 5         // minimum basis to execute
const BOOK_CAP_PCT            = 0.25      // max 25% of top-of-book depth
const MAX_NOTIONAL_USD        = 50_000    // hard cap per position
const MIN_NOTIONAL_USD        = 500       // minimum worth executing
const TRADE_RISK_PCT          = 0.02      // 2% per trade
const FUNDING_SETTLE_BUFFER_M = 30        // skip new entries within 30 min of settlement

// ─── Watched symbols ──────────────────────────────────────────────────────────

const WATCHED_SYMBOLS = ['BTC', 'ETH', 'SOL']

// ─── Book depth proxy ─────────────────────────────────────────────────────────

/**
 * Fetch approximate top-of-book depth from Binance futures public API (no key).
 */
async function getBookDepthUsd(symbol: string): Promise<number | null> {
  try {
    const pair = `${symbol}USDT`
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/depth?symbol=${pair}&limit=5`,
      { signal: AbortSignal.timeout(4_000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    const bids: [string, string][] = data.bids ?? []
    return bids.reduce((sum, [price, qty]) => sum + parseFloat(price) * parseFloat(qty), 0) || null
  } catch {
    return null
  }
}

// ─── Minutes to next funding settlement (00:00, 08:00, 16:00 UTC) ────────────
// Exported so tests can vi.mock this module and override for deterministic results.

export function minutesToNextFundingSettlement(): number {
  const now = new Date()
  const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes()
  const settlements = [0, 480, 960, 1440]
  for (const s of settlements) {
    if (s > minuteOfDay) return s - minuteOfDay
  }
  return 1440
}

// ─── Spot price from CoinGecko (public, no key) ───────────────────────────────

const COINGECKO_IDS: Record<string, string> = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana' }

async function getSpotPrice(symbol: string): Promise<number | null> {
  const id = COINGECKO_IDS[symbol]
  if (!id) return null
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(5_000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    return (data[id]?.usd as number | undefined) ?? null
  } catch {
    return null
  }
}

// ─── Strategy ─────────────────────────────────────────────────────────────────

export class FundingBasisArbStrategy extends BasePipelineStrategy {
  readonly key = 'funding_basis_arb' as const
  readonly displayName = 'Funding Basis Arb'
  readonly assetClass = 'crypto' as const

  async detectOpportunities(ctx: OpportunityContext): Promise<Opportunity[]> {
    const opportunities: Opportunity[] = []

    // Skip new entries within 30 min of funding settlement
    const minsToSettle = minutesToNextFundingSettlement()
    if (minsToSettle < FUNDING_SETTLE_BUFFER_M) return []

    const symbols = (ctx.metadata?.symbols as string[] | undefined) ?? WATCHED_SYMBOLS

    for (const symbol of symbols) {
      const [fundingData, spotPrice, bookDepth] = await Promise.all([
        getFundingRate(symbol),
        getSpotPrice(symbol),
        getBookDepthUsd(symbol),
      ])

      if (fundingData.source === 'unavailable') continue
      if (fundingData.rate < HIGH_FUNDING_THRESHOLD) continue
      if (!spotPrice) continue

      // Estimated perp price from funding premium
      const perpPrice = spotPrice * (1 + fundingData.rate * 3)
      const basisBps  = ((perpPrice - spotPrice) / spotPrice) * 10_000
      if (basisBps < MIN_SPREAD_BPS) continue

      // Book-depth cap: 25% of depth or MAX_NOTIONAL_USD
      const capNotional = bookDepth
        ? Math.min(bookDepth * BOOK_CAP_PCT, MAX_NOTIONAL_USD)
        : MAX_NOTIONAL_USD

      const annualisedCarry = fundingData.annualised
      const strength = Math.min(1, annualisedCarry / 0.30)
      const expectedReturn = annualisedCarry / 365

      opportunities.push({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: `${symbol}-PERP`,
        direction: 'neutral',
        assetClass: this.assetClass,
        strength,
        expectedReturn,
        metadata: {
          symbol,
          fundingRate: fundingData.rate,
          annualisedCarry,
          fundingSource: fundingData.source,
          basisBps,
          spotPrice,
          perpPrice,
          bookDepth,
          capNotional,
          minsToNextSettlement: minsToSettle,
          reasoning: `${symbol} funding ${(fundingData.rate * 100).toFixed(4)}%/8h (${(annualisedCarry * 100).toFixed(1)}% ann). Basis ${basisBps.toFixed(1)}bps. Book cap $${(capNotional / 1000).toFixed(0)}k.`,
        },
        detectedAt: new Date().toISOString(),
      })
    }

    return opportunities
  }

  async runRedTeam(opp: Opportunity): Promise<RedTeamVerdict> {
    const rate        = (opp.metadata.fundingRate  as number | undefined) ?? 0
    const basisBps    = (opp.metadata.basisBps     as number | undefined) ?? 0
    const capNotional = (opp.metadata.capNotional  as number | undefined) ?? 0

    if (rate < HIGH_FUNDING_THRESHOLD)  return { passed: false, score: 10, reason: `Funding ${(rate * 100).toFixed(4)}%/8h below threshold` }
    if (basisBps < MIN_SPREAD_BPS)      return { passed: false, score: 15, reason: `Basis ${basisBps.toFixed(1)}bps below minimum` }
    if (capNotional < MIN_NOTIONAL_USD) return { passed: false, score: 20, reason: `Book-capped notional $${capNotional.toFixed(0)} too small` }

    // Opposing risk: funding can reverse suddenly near macro events
    const baseScore = Math.min(100, opp.strength * 80 + basisBps * 2)

    return {
      passed: baseScore >= 40,
      score: baseScore,
      reason: baseScore < 40
        ? `Carry too thin for execution costs (score ${baseScore.toFixed(0)})`
        : undefined,
    }
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

    const capNotional = (opp.metadata.capNotional as number | undefined) ?? MAX_NOTIONAL_USD

    // Quarter-Kelly on carry edge (no MiroFish/Kronos haircut for structural strategies)
    const qk = quarterKelly(opp.strength, opp.expectedReturn / 0.002)
    let fraction = Math.min(qk, TRADE_RISK_PCT, maxSinglePct / 100)
    fraction = Math.max(fraction, 0.005)

    const kellyNotional = fraction * portfolio
    const notionalUsd   = Math.min(kellyNotional, capNotional, MAX_NOTIONAL_USD)

    return {
      fraction: notionalUsd / portfolio,
      notionalUsd,
      rationale: `QK=${(qk * 100).toFixed(1)}% carry, book-cap=$${(capNotional / 1000).toFixed(0)}k, rate=${((opp.metadata.fundingRate as number) * 100).toFixed(4)}%/8h`,
    }
  }

  /**
   * Dual-leg execution: long spot (coinbase) + short perp (binance_us / kraken_futures).
   */
  async execute(
    opp: Opportunity,
    size: PositionSize,
    userId: string,
    supabase?: SupabaseClient,
    cache?: BrokerCache,
  ): Promise<ExecutionResult> {
    if (!supabase) return { status: 'skipped', broker: 'none', error: 'no supabase' }

    const symbol = (opp.metadata.symbol as string | undefined) ?? 'BTC'

    const { broker: spotBroker } = selectBroker({ assetClass: 'crypto_spot', userJurisdiction: 'us' })
    const spotAdapter = await getBroker(spotBroker, userId, supabase, cache)
    const spotResult = await spotAdapter.execute({
      symbol,
      asset_class: 'crypto',
      side: 'buy',
      notional_usd: size.notionalUsd,
    })

    const { broker: perpBroker } = selectBroker({ assetClass: 'crypto_perp', userJurisdiction: 'us' })
    const perpAdapter = await getBroker(perpBroker, userId, supabase, cache)
    const perpResult = await perpAdapter.execute({
      symbol: opp.symbol,
      asset_class: 'crypto',
      side: 'sell',
      notional_usd: size.notionalUsd,
    })

    const failed = spotResult.status === 'failed' || perpResult.status === 'failed'
    return {
      status: failed ? 'failed' : 'submitted',
      broker: `${spotBroker}+${perpBroker}`,
      brokerOrderId: [spotResult.broker_order_id, perpResult.broker_order_id].filter(Boolean).join(','),
      error: spotResult.error ?? perpResult.error,
    }
  }

  /**
   * Exit when:
   *  - Funding rate flips negative (carry reverses, exit immediately)
   *  - Annualised basis compressed below 5% APR (no longer worthwhile)
   *  - Max hold (liquidation buffer): 2x the perp margin cycle (48h default)
   */
  async manageOpenPosition(
    position: OpenPosition,
    _tick: PriceTick
  ): Promise<ManageAction> {
    const symbol = (position.metadata.symbol as string | undefined) ?? 'BTC'
    const openAnnualised = (position.metadata.annualisedCarry as number | undefined) ?? 0

    let currentFunding: Awaited<ReturnType<typeof getFundingRate>> | null = null
    try {
      currentFunding = await getFundingRate(symbol)
    } catch {
      return { type: 'hold' }  // data unavailable, hold and retry next tick
    }

    if (currentFunding.source === 'unavailable') return { type: 'hold' }

    // Funding flipped negative: reverse of carry -- exit both legs
    if (currentFunding.rate < 0) {
      return { type: 'close', reason: `funding flipped negative (${(currentFunding.rate * 100).toFixed(4)}%/8h)` }
    }

    // Basis compressed below 5% APR: no longer economic net of fees
    const BASIS_FLOOR_APR = 0.05
    if (currentFunding.annualised < BASIS_FLOOR_APR) {
      return {
        type: 'close',
        reason: `basis compressed to ${(currentFunding.annualised * 100).toFixed(1)}% APR < 5% floor`,
      }
    }

    // Alert-only: carry degraded >70% from entry (no close -- still positive, just weaker)
    if (openAnnualised > 0 && currentFunding.annualised < openAnnualised * 0.30) {
      console.log(`[funding_basis_arb] ${symbol} carry degraded ${(currentFunding.annualised * 100).toFixed(1)}% vs entry ${(openAnnualised * 100).toFixed(1)}% -- monitoring`)
    }

    // Hard timeout: 14 days (2x 8h settlement cycle buffer)
    const holdDays = (Date.now() - position.openedAt) / 86_400_000
    if (holdDays >= 14) {
      return { type: 'close', reason: '14-day funding basis arb timeout' }
    }

    return { type: 'hold' }
  }
}
