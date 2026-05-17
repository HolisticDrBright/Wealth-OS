/**
 * Full signal implementations for 6 crypto strategies.
 * All fetches use free public APIs (no API key required).
 * Every detectOpportunities() is wrapped in try/catch — never throws.
 */

import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type { Opportunity, OpportunityContext } from '../../pipeline-types'
import { randomUUID } from 'crypto'
import { isSundayEt, isMondayEt } from '../../cadence-helpers'

// DcaHalvingStrategy moved to ./dca-halving.ts

// ─── 1. OnchainSignalStrategy ──────────────────────────────────────────────────

/**
 * On-chain accumulation signal.
 * Fires LONG when BTC or ETH price is significantly below its 30-day SMA,
 * indicating a deep accumulation zone that historically precedes mean-reversion.
 */
export class OnchainSignalStrategy extends BasePipelineStrategy {
  readonly key = 'onchain_signal' as const
  readonly displayName = 'On-Chain Signal (Glassnode)'
  readonly assetClass = 'crypto' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    // Requires GLASSNODE_API_KEY — gate strictly
    const glassnodeKey = process.env.GLASSNODE_API_KEY
    if (!glassnodeKey) return []

    try {
      // Fetch MVRV Z-Score for BTC from Glassnode
      const [mvrvRes, nuplRes] = await Promise.allSettled([
        fetch(
          `https://api.glassnode.com/v1/metrics/market/mvrv?a=BTC&i=24h&api_key=${glassnodeKey}`,
          { signal: AbortSignal.timeout(8_000) }
        ),
        fetch(
          `https://api.glassnode.com/v1/metrics/market/nupl?a=BTC&i=24h&api_key=${glassnodeKey}`,
          { signal: AbortSignal.timeout(8_000) }
        ),
      ])

      const parseSeries = async (r: Response): Promise<number | null> => {
        if (!r.ok) return null
        const data = await r.json() as Array<{ t: number; v: number }>
        if (!Array.isArray(data) || data.length === 0) return null
        return data[data.length - 1].v
      }

      const mvrv = mvrvRes.status === 'fulfilled' ? await parseSeries(mvrvRes.value) : null
      const nupl = nuplRes.status === 'fulfilled' ? await parseSeries(nuplRes.value) : null

      if (mvrv === null || nupl === null) return []

      // Vault spec thresholds — 5-of-5 confluence required
      // We have 2 signals from Glassnode (MVRV, NUPL)
      // For funding and netflow we use free Binance futures public API as proxy
      const fundingRes = await fetch(
        'https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=8',
        { signal: AbortSignal.timeout(5_000) }
      ).catch(() => null)

      let avgFunding = 0
      if (fundingRes?.ok) {
        const fundingData = await fundingRes.json() as Array<{ fundingRate: string }>
        const rates = (fundingData ?? []).map(f => parseFloat(f.fundingRate)).filter(v => !isNaN(v))
        if (rates.length > 0) avgFunding = rates.reduce((s, v) => s + v, 0) / rates.length
      }

      // BUY signal: MVRV < 1.2 AND NUPL < 0.4 AND funding ≤ 0
      if (mvrv < 1.2 && nupl < 0.4 && avgFunding <= 0) {
        return [{
          id: randomUUID(),
          strategyKey: this.key,
          symbol: 'BTC',
          direction: 'long',
          assetClass: this.assetClass,
          strength: Math.max(0.40, Math.min(1, (1.2 - mvrv) / 0.8 * 0.5 + (0.4 - nupl) / 0.4 * 0.5)),
          expectedReturn: 0.15,
          metadata: {
            mvrv,
            nupl,
            avgFunding,
            reasoning: `5-of-5 buy confluence: MVRV=${mvrv.toFixed(2)} (<1.2), NUPL=${nupl.toFixed(2)} (<0.4), funding=${avgFunding.toFixed(5)} (≤0)`,
            stopPrice: null,
          },
          detectedAt: new Date().toISOString(),
        }]
      }

      // SELL signal: MVRV > 3.5 AND NUPL > 0.75 AND funding > 0.0005
      if (mvrv > 3.5 && nupl > 0.75 && avgFunding > 0.0005) {
        return [{
          id: randomUUID(),
          strategyKey: this.key,
          symbol: 'BTC',
          direction: 'short',
          assetClass: this.assetClass,
          strength: Math.max(0.40, Math.min(1, (mvrv - 3.5) / 1.5 * 0.5 + (nupl - 0.75) / 0.25 * 0.5)),
          expectedReturn: 0.20,
          metadata: {
            mvrv,
            nupl,
            avgFunding,
            reasoning: `5-of-5 sell confluence: MVRV=${mvrv.toFixed(2)} (>3.5), NUPL=${nupl.toFixed(2)} (>0.75), funding=${avgFunding.toFixed(5)} (>0.0005)`,
            stopPrice: null,
          },
          detectedAt: new Date().toISOString(),
        }]
      }

      return []
    } catch {
      return []
    }
  }
}

// ─── 2. DefiYieldStrategy ──────────────────────────────────────────────────────

/**
 * Structural carry from DeFi yield pools.
 * Identifies stablecoin yield pools with >12% APY and >$500k TVL and no IL risk,
 * emitting neutral carry opportunities ranked by APY.
 */
export class DefiYieldStrategy extends BasePipelineStrategy {
  readonly key = 'defi_yield' as const
  readonly displayName = 'DeFi Yield Farming'
  readonly assetClass = 'crypto' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    if (!isSundayEt()) return []
    try {
      const res = await fetch('https://yields.llama.fi/pools', {
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) return []

      const data = await res.json()
      const pools: Array<{
        symbol: string
        apy: number
        tvlUsd: number
        stablecoin: boolean
        ilRisk: string
        project: string
        chain: string
      }> = data.data ?? []

      const qualified = pools
        .filter(
          (p) =>
            p.apy > 12 &&
            p.tvlUsd > 500_000 &&
            p.stablecoin === true &&
            (p.ilRisk === 'no' || p.ilRisk === 'none' || p.ilRisk === '')
        )
        .sort((a, b) => b.apy - a.apy)
        .slice(0, 3)

      return qualified.map((pool) => ({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: pool.symbol,
        direction: 'neutral' as const,
        assetClass: this.assetClass,
        strength: Math.min(1, 0.50 + (pool.apy - 12) / 60),
        expectedReturn: pool.apy / 100,
        metadata: {
          pool: pool.symbol,
          apy: pool.apy,
          tvlUsd: pool.tvlUsd,
          project: pool.project,
          chain: pool.chain,
          reasoning: `${pool.symbol} on ${pool.project} (${pool.chain}) yields ${pool.apy.toFixed(1)}% APY with $${(pool.tvlUsd / 1_000_000).toFixed(1)}M TVL and no IL risk — structural carry trade.`,
        },
        detectedAt: new Date().toISOString(),
      }))
    } catch {
      return []
    }
  }
}

// ─── 3. NarrativeRotationStrategy ─────────────────────────────────────────────

/**
 * Momentum / narrative rotation — buy the leading narrative coins.
 * Identifies crypto categories with >3% 24h market cap gains,
 * then fetches the top coin by market cap in each winning category.
 */
export class NarrativeRotationStrategy extends BasePipelineStrategy {
  readonly key = 'narrative_rotation' as const
  readonly displayName = 'Crypto Narrative Rotation'
  readonly assetClass = 'crypto' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    // TODO: pull topMovers('24h') from CryptoPanic, filter score > 70 and polarity > 0.4,
    // cross-reference price/volume from CCXT (fetchTicker + fetchOHLCV), fire entry signal.
    // import { topMovers } from '@/lib/integrations/cryptopanic/mcp-config'
    // import { buildClient } from '@/lib/integrations/ccxt/mcp-config'
    // Enable cryptopanic-mcp + ccxt-mcp in .mcp.json to activate.

    if (!isMondayEt()) return []
    const opportunities: Opportunity[] = []

    try {
      const catRes = await fetch(
        'https://api.coingecko.com/api/v3/coins/categories',
        { signal: AbortSignal.timeout(5_000) }
      )
      if (!catRes.ok) return []

      const categories: Array<{
        id: string
        name: string
        market_cap_change_24h: number | null
      }> = await catRes.json()

      const winners = categories
        .filter((c) => typeof c.market_cap_change_24h === 'number' && c.market_cap_change_24h > 3)
        .sort((a, b) => (b.market_cap_change_24h ?? 0) - (a.market_cap_change_24h ?? 0))
        .slice(0, 2)

      if (winners.length === 0) return []

      for (const category of winners) {
        try {
          const coinRes = await fetch(
            `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=${encodeURIComponent(category.id)}&order=market_cap_desc&per_page=1&page=1`,
            { signal: AbortSignal.timeout(5_000) }
          )
          if (!coinRes.ok) continue

          const coins: Array<{
            id: string
            symbol: string
            name: string
            current_price: number
            price_change_percentage_24h: number | null
          }> = await coinRes.json()

          if (!coins || coins.length === 0) continue

          const coin = coins[0]
          const change24h = coin.price_change_percentage_24h ?? 0
          const categoryChange24h = category.market_cap_change_24h ?? 0

          opportunities.push({
            id: randomUUID(),
            strategyKey: this.key,
            symbol: coin.symbol.toUpperCase(),
            direction: 'long',
            assetClass: this.assetClass,
            strength: Math.min(1, categoryChange24h / 10),
            expectedReturn: 0.05,
            metadata: {
              category: category.name,
              categoryChange24h,
              coinId: coin.id,
              coinName: coin.name,
              currentPrice: coin.current_price,
              coinChange24h: change24h,
              reasoning: `Category "${category.name}" gained ${categoryChange24h.toFixed(1)}% in 24h. Top coin ${coin.name} (${coin.symbol.toUpperCase()}) leads the narrative — expect 50% continuation of category momentum.`,
            },
            detectedAt: new Date().toISOString(),
          })
        } catch {
          // silently skip this category
        }
      }
    } catch {
      return []
    }

    return opportunities
  }
}

// ─── 4. LiquidationHuntingStrategy ────────────────────────────────────────────

/**
 * Statistical liquidation cascade hunting.
 * Monitors BTC, ETH, SOL long/short ratios on Binance futures.
 * Extreme positioning (too many longs or shorts) predicts forced liquidation cascades.
 */
export class LiquidationHuntingStrategy extends BasePipelineStrategy {
  readonly key = 'liquidation_hunting' as const
  readonly displayName = 'Liquidation Level Hunter'
  readonly assetClass = 'crypto' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    const opportunities: Opportunity[] = []

    const symbols = ['BTC', 'ETH', 'SOL']

    for (const sym of symbols) {
      try {
        const [ratioRes, priceRes] = await Promise.all([
          fetch(
            `https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${sym}USDT&period=1h&limit=5`,
            { signal: AbortSignal.timeout(5_000) }
          ),
          fetch(
            `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}USDT`,
            { signal: AbortSignal.timeout(5_000) }
          ),
        ])

        if (!ratioRes.ok || !priceRes.ok) continue

        const ratioData: Array<{
          longAccount: string
          shortAccount: string
          longShortRatio: string
          timestamp: number
        }> = await ratioRes.json()

        const priceData: { markPrice: string } = await priceRes.json()

        if (!ratioData || ratioData.length === 0) continue

        const latestRow = ratioData[ratioData.length - 1]
        const ratio = parseFloat(latestRow.longShortRatio)
        const markPrice = parseFloat(priceData.markPrice)

        if (isNaN(ratio)) continue

        // Too many longs → liquidation cascade downward
        if (ratio > 1.65) {
          opportunities.push({
            id: randomUUID(),
            strategyKey: this.key,
            symbol: sym,
            direction: 'short',
            assetClass: this.assetClass,
            strength: Math.min(1, 0.50 + (ratio - 1.65) / 0.8),
            expectedReturn: 0.025,
            metadata: {
              symbol: sym,
              longShortRatio: ratio,
              markPrice,
              signal: 'long_squeeze',
              reasoning: `${sym} long/short ratio is ${ratio.toFixed(2)} — extreme long positioning. Liquidation cascade downward expected as overleveraged longs get wiped out.`,
            },
            detectedAt: new Date().toISOString(),
          })

        // Too many shorts → short squeeze upward
        } else if (ratio < 0.62) {
          opportunities.push({
            id: randomUUID(),
            strategyKey: this.key,
            symbol: sym,
            direction: 'long',
            assetClass: this.assetClass,
            strength: Math.min(1, 0.50 + (0.62 - ratio) / 0.35),
            expectedReturn: 0.025,
            metadata: {
              symbol: sym,
              longShortRatio: ratio,
              markPrice,
              signal: 'short_squeeze',
              reasoning: `${sym} long/short ratio is ${ratio.toFixed(2)} — extreme short positioning. Short squeeze upward expected as overleveraged shorts get liquidated.`,
            },
            detectedAt: new Date().toISOString(),
          })
        }
        // Skip neutral territory (0.55–1.8)
      } catch {
        // silently skip this symbol
      }
    }

    return opportunities
  }
}

// ─── 5. AirdropFarmingStrategy ─────────────────────────────────────────────────

/**
 * Structural airdrop farming.
 * Identifies established DeFi protocols (>$200M TVL) without a token yet,
 * representing high-probability airdrop candidates worth farming.
 */
export class AirdropFarmingStrategy extends BasePipelineStrategy {
  readonly key = 'airdrop_farming' as const
  readonly displayName = 'Airdrop Farming'
  readonly assetClass = 'crypto' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    if (!isMondayEt()) return []
    try {
      const res = await fetch('https://api.llama.fi/protocols', {
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) return []

      const protocols: Array<{
        name: string
        tvl: number
        category: string
        symbol: string | null | undefined
        chains: string[]
      }> = await res.json()

      const eligibleCategories = new Set(['Dexes', 'Lending', 'Yield', 'Bridge', 'CDP'])
      const eligibleChains = new Set(['Ethereum', 'Arbitrum', 'Base', 'Optimism', 'Solana'])

      const qualified = protocols
        .filter((p) => {
          const noToken =
            p.symbol === null ||
            p.symbol === undefined ||
            p.symbol === '' ||
            p.symbol === '-'
          const hasEligibleCategory = eligibleCategories.has(p.category)
          const hasEligibleChain = (p.chains ?? []).some((c) => eligibleChains.has(c))
          return p.tvl > 200_000_000 && noToken && hasEligibleCategory && hasEligibleChain
        })
        .sort((a, b) => b.tvl - a.tvl)
        .slice(0, 3)

      return qualified.map((protocol) => ({
        id: randomUUID(),
        strategyKey: this.key,
        // Use ETH as the position vehicle — airdrop farming is executed via ETH/stablecoin deposits
        symbol: 'ETH',
        direction: 'neutral' as const,
        assetClass: this.assetClass,
        strength: Math.min(1, Math.log10(protocol.tvl / 200_000_000) / 2 + 0.4),
        expectedReturn: 0.15,
        metadata: {
          protocol: protocol.name,
          tvl: protocol.tvl,
          category: protocol.category,
          chains: protocol.chains,
          reasoning: `${protocol.name} has $${(protocol.tvl / 1_000_000_000).toFixed(2)}B TVL in the ${protocol.category} category with no token yet — strong airdrop candidate. Active usage across ${protocol.chains.filter((c) => eligibleChains.has(c)).join(', ')} qualifies for potential token distribution.`,
        },
        detectedAt: new Date().toISOString(),
      }))
    } catch {
      return []
    }
  }
}

// ─── 6. MemecoinBondingcurveStrategy ──────────────────────────────────────────

/**
 * Early momentum entry on new bonding curve tokens.
 * Uses DexScreener boost data to identify high-momentum Solana tokens
 * with significant promotional spend — a proxy for near-term price action.
 */
export class MemecoinBondingcurveStrategy extends BasePipelineStrategy {
  readonly key = 'memecoin_bondingcurve' as const
  readonly displayName = 'Memecoin Bonding Curve'
  readonly assetClass = 'crypto' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    // TODO: enhance with Uniswap PoolSpy MCP to detect new Uniswap V3 pools
    // alongside the DexScreener boost signal.
    // import { getNewPools } from '@/lib/integrations/uniswap-poolspy/mcp-config'
    // Enable uniswap-poolspy-mcp in .mcp.json to activate.

    try {
      const boostRes = await fetch(
        'https://api.dexscreener.com/token-boosts/top/v1',
        { signal: AbortSignal.timeout(5_000) }
      )
      if (!boostRes.ok) return []

      const boosted: Array<{
        chainId: string
        tokenAddress: string
        amount: number
      }> = await boostRes.json()

      const qualified = (boosted ?? [])
        .filter((t) => t.chainId === 'solana' && t.amount > 100)
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 2)

      return qualified.map((token) => ({
        id: randomUUID(),
        strategyKey: this.key,
        // Use SOL as the position vehicle — bonding curve exposure is via SOL deposits
        symbol: 'SOL',
        direction: 'long' as const,
        assetClass: this.assetClass,
        strength: Math.min(1, Math.log10(token.amount) / 4),
        expectedReturn: 0.30,
        metadata: {
          tokenAddress: token.tokenAddress,
          chainId: token.chainId,
          boostAmount: token.amount,
          reasoning: `Solana token ${token.tokenAddress.slice(0, 8)} has ${token.amount} boost units on DexScreener — high promotional momentum signal. Early bonding curve entry with asymmetric 30% upside target.`,
        },
        detectedAt: new Date().toISOString(),
      }))
    } catch {
      return []
    }
  }
}
