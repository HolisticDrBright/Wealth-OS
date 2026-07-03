/**
 * ETF Basis Arb — STRUCTURAL CARRY (cross-asset)
 * Source: TIER 3 T3.3
 * Edge: structural (#edge/structural)
 * Asset: multi-asset → alpaca (ETF leg) + binance_us (perp leg)
 * AI Confluence: Kronos=skip, MiroFish=skip
 *
 * Delta-neutral: long spot BTC/ETH ETF + short perpetual futures when funding
 * APR spread exceeds 8% net of fees. Earns the funding rate while the ETF
 * tracks the spot price. Exit when funding APR compresses below 5% or flips.
 *
 * Minimum ETF AUM: $500M (liquidity gate). Size: 5% of portfolio.
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
import { getFundingApr } from '@/lib/market-data/coinglass'
import { getPortfolioUsd, getRiskControl } from '../../risk-controls'
import { applyEmpiricalHaircuts, zeroSize } from '@/lib/risk/empirical-sizing'
import { randomUUID } from 'crypto'

// ─── ETF / Perp pairs ─────────────────────────────────────────────────────────

const ETF_PAIRS = [
  { etf: 'IBIT', perp: 'BTCUSDT', crypto: 'BTC' },
  { etf: 'FBTC', perp: 'BTCUSDT', crypto: 'BTC' },
  { etf: 'ETHA', perp: 'ETHUSDT', crypto: 'ETH' },
  { etf: 'ETHE', perp: 'ETHUSDT', crypto: 'ETH' },
]

const MIN_FUNDING_APR    = 0.08   // 8% APR minimum (net of fees ~0.5%)
const MIN_AUM_USD        = 500_000_000   // $500M minimum ETF AUM
const TRADE_RISK_PCT     = 0.05   // 5% of portfolio
const EXIT_APR_FLOOR     = 0.05   // exit below 5% APR

// ETF AUM from public data (approximate, updated periodically)
const ETF_AUM: Record<string, number> = {
  IBIT: 40_000_000_000,
  FBTC: 15_000_000_000,
  ETHA:  3_000_000_000,
  ETHE:  8_000_000_000,
}

async function getEtfPrice(symbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return null
    const data: unknown = await res.json()
    const result = ((data as Record<string, unknown>)?.chart as Record<string, unknown>)
      ?.result as unknown[]
    const meta = (result?.[0] as Record<string, unknown>)?.meta as Record<string, unknown>
    return (meta?.regularMarketPrice as number | undefined) ?? null
  } catch {
    return null
  }
}

// ─── Strategy ─────────────────────────────────────────────────────────────────

export class EtfBasisArbStrategy extends BasePipelineStrategy {
  readonly key = 'etf_basis_arb' as const
  readonly displayName = 'ETF Basis Arb'
  readonly assetClass = 'multi-asset' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    const opportunities: Opportunity[] = []

    for (const pair of ETF_PAIRS) {
      const aum = ETF_AUM[pair.etf] ?? 0
      if (aum < MIN_AUM_USD) continue

      const [fundingApr, etfPrice] = await Promise.all([
        getFundingApr(pair.perp),
        getEtfPrice(pair.etf),
      ])

      if (fundingApr === null) continue
      if (fundingApr - 0.005 < MIN_FUNDING_APR) continue   // net of ~0.5% fees
      if (!etfPrice) continue

      const strength = Math.min(1, (fundingApr - 0.005) / 0.30)
      const expectedReturn = fundingApr / 365   // daily carry

      opportunities.push({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: `${pair.etf}_${pair.perp}_BASIS`,
        direction: 'neutral',
        assetClass: this.assetClass,
        strength,
        expectedReturn,
        metadata: {
          etf: pair.etf,
          perp: pair.perp,
          crypto: pair.crypto,
          fundingApr,
          etfPrice,
          aumUsd: aum,
          reasoning: `ETF basis: ${pair.etf}/${pair.perp} funding ${(fundingApr * 100).toFixed(2)}% APR, AUM $${(aum / 1e9).toFixed(1)}B`,
        },
        detectedAt: new Date().toISOString(),
      })
    }

    return opportunities
  }

  async runRedTeam(opp: Opportunity): Promise<RedTeamVerdict> {
    const apr = (opp.metadata.fundingApr as number | undefined) ?? 0
    if (apr - 0.005 < MIN_FUNDING_APR) {
      return { passed: false, score: 15, reason: `Net APR ${((apr - 0.005) * 100).toFixed(1)}% < ${MIN_FUNDING_APR * 100}% threshold` }
    }
    const score = Math.min(100, 40 + (apr - 0.005) * 300)
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

    const structural = Math.min(TRADE_RISK_PCT, maxSinglePct / 100)
    const hc = await applyEmpiricalHaircuts(structural, { supabase, strategyKey: this.key })
    if (hc.blocked) return zeroSize(hc.reason ?? 'maturity blocked')
    const notionalUsd = hc.fraction * portfolio

    return {
      fraction: hc.fraction,
      notionalUsd,
      rationale: `structural carry × empirical haircuts, funding ${((opp.metadata.fundingApr as number) * 100).toFixed(1)}% APR`,
    }
  }

  async manageOpenPosition(position: OpenPosition, _tick: PriceTick): Promise<ManageAction> {
    const perp = (position.metadata.perp as string | undefined) ?? 'BTCUSDT'

    const currentApr = await getFundingApr(perp)
    if (currentApr === null) return { type: 'hold' }

    if (currentApr < 0) {
      return { type: 'close', reason: `funding flipped negative (${(currentApr * 100).toFixed(2)}% APR)` }
    }
    if (currentApr < EXIT_APR_FLOOR) {
      return { type: 'close', reason: `basis compressed to ${(currentApr * 100).toFixed(1)}% APR < ${EXIT_APR_FLOOR * 100}% floor` }
    }

    const holdDays = (Date.now() - position.openedAt) / 86_400_000
    if (holdDays >= 14) {
      return { type: 'close', reason: '14-day ETF basis arb timeout' }
    }

    return { type: 'hold' }
  }
}
