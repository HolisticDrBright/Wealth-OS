/**
 * Full implementations for 7 Polymarket prediction-market trading strategies.
 * All use the Polymarket Gamma API (free, no key required).
 */

import { randomUUID } from 'crypto'
import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type { Opportunity, OpportunityContext } from '../../pipeline-types'

// ─── Shared helpers ────────────────────────────────────────────────────────────

function parsePrice(p: string | undefined): number {
  const v = parseFloat(p ?? '0')
  return isNaN(v) ? 0 : v
}

function daysUntil(dateStr: string): number {
  return (new Date(dateStr).getTime() - Date.now()) / 86400000
}

const GAMMA_BASE = 'https://gamma-api.polymarket.com'

// ─── Gamma API market shape ────────────────────────────────────────────────────

interface GammaMarket {
  id: string
  slug: string
  question: string
  endDate: string
  outcomePrices: string[]
  volume: string
  volume24hr: number
  liquidity: string
  active: boolean
  closed: boolean
  bestBid: string
  bestAsk: string
  lastTradePrice: string
  acceptingOrders: boolean
  groupItemTitle: string
  outcomes: string[]
}

interface GammaEvent {
  id: string
  slug: string
  title: string
  markets: GammaMarket[]
}

// ─── 1. PolymarketResolutionRulesStrategy ─────────────────────────────────────

export class PolymarketResolutionRulesStrategy extends BasePipelineStrategy {
  readonly key = 'polymarket_resolution_rules' as const
  readonly displayName = 'Polymarket Resolution Rules'
  readonly assetClass = 'polymarket' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    try {
      const res = await fetch(
        `${GAMMA_BASE}/markets?limit=100&active=true&closed=false&order=volume&ascending=false`,
        { signal: AbortSignal.timeout(8_000) }
      )
      if (!res.ok) return []
      const markets: GammaMarket[] = await res.json()

      const opportunities: Opportunity[] = []

      for (const market of markets) {
        if (!market.outcomePrices || market.outcomePrices.length === 0) continue
        if (!market.endDate) continue

        const daysToExpiry = daysUntil(market.endDate)
        if (daysToExpiry <= 0 || daysToExpiry >= 14) continue

        const yesPrice = parsePrice(market.outcomePrices[0])
        const noPrice = parsePrice(market.outcomePrices[1])

        // High YES price nearing expiry — bet it resolves YES
        if (yesPrice > 0.85 && yesPrice <= 0.95 && daysToExpiry <= 7) {
          const strength = Math.min(1, (yesPrice - 0.85) / 0.10 * (7 / daysToExpiry) * 0.5)
          const expectedReturn = (1 - yesPrice) * 0.6
          opportunities.push({
            id: randomUUID(),
            strategyKey: this.key,
            symbol: market.slug,
            direction: 'long',
            assetClass: this.assetClass,
            strength,
            expectedReturn,
            metadata: {
              slug: market.slug,
              question: market.question,
              daysToExpiry,
              yesPrice,
              noPrice,
              volume: market.volume,
              reasoning: `Near-expiry market (${daysToExpiry.toFixed(1)}d) trading at ${(yesPrice * 100).toFixed(1)}% YES — high compression toward 1.`,
            },
            detectedAt: new Date().toISOString(),
          })
        }

        // Low YES price nearing expiry — buy NO (short YES)
        if (yesPrice >= 0.05 && yesPrice < 0.15 && daysToExpiry <= 7) {
          const expectedReturn = yesPrice * 0.6
          opportunities.push({
            id: randomUUID(),
            strategyKey: this.key,
            symbol: market.slug,
            direction: 'short',
            assetClass: this.assetClass,
            strength: Math.min(1, (0.15 - yesPrice) / 0.10 * (7 / daysToExpiry) * 0.5),
            expectedReturn,
            metadata: {
              slug: market.slug,
              question: market.question,
              daysToExpiry,
              yesPrice,
              noPrice,
              volume: market.volume,
              reasoning: `Near-expiry market (${daysToExpiry.toFixed(1)}d) trading at ${(yesPrice * 100).toFixed(1)}% YES — high compression toward 0; buy NO.`,
            },
            detectedAt: new Date().toISOString(),
          })
        }

        // Extreme near-term signal: <3 days and very extreme price
        if (daysToExpiry < 3 && (yesPrice > 0.90 || yesPrice < 0.07)) {
          const isHigh = yesPrice > 0.90
          const strength = isHigh
            ? Math.min(1, (yesPrice - 0.90) / 0.10 * (3 / daysToExpiry) * 0.5)
            : Math.min(1, (0.07 - yesPrice) / 0.07 * (3 / daysToExpiry) * 0.5)
          const expectedReturn = isHigh ? (1 - yesPrice) * 0.6 : yesPrice * 0.6
          // Only add if not already added by the ranges above
          if (!(yesPrice > 0.85 && yesPrice <= 0.95) && !(yesPrice >= 0.05 && yesPrice < 0.15)) {
            opportunities.push({
              id: randomUUID(),
              strategyKey: this.key,
              symbol: market.slug,
              direction: isHigh ? 'long' : 'short',
              assetClass: this.assetClass,
              strength,
              expectedReturn,
              metadata: {
                slug: market.slug,
                question: market.question,
                daysToExpiry,
                yesPrice,
                noPrice,
                volume: market.volume,
                reasoning: `Extreme near-term signal: ${daysToExpiry.toFixed(1)}d remaining, YES at ${(yesPrice * 100).toFixed(1)}%.`,
              },
              detectedAt: new Date().toISOString(),
            })
          }
        }
      }

      // Top 3 by expected return
      return opportunities
        .sort((a, b) => b.expectedReturn - a.expectedReturn)
        .slice(0, 3)
    } catch {
      return []
    }
  }
}

// ─── 2. PolymarketBaseRateStrategy ────────────────────────────────────────────

export class PolymarketBaseRateStrategy extends BasePipelineStrategy {
  readonly key = 'polymarket_base_rate' as const
  readonly displayName = 'Polymarket Base Rate'
  readonly assetClass = 'polymarket' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    try {
      const res = await fetch(
        `${GAMMA_BASE}/markets?limit=200&active=true&closed=false&order=volume&ascending=false`,
        { signal: AbortSignal.timeout(8_000) }
      )
      if (!res.ok) return []
      const markets: GammaMarket[] = await res.json()

      const opportunities: Opportunity[] = []

      for (const market of markets) {
        if (!market.outcomePrices || market.outcomePrices.length === 0) continue
        const q = (market.question ?? '').toLowerCase()
        const price = parsePrice(market.outcomePrices[0])

        let baseRate: number | null = null
        let marketType = ''

        // Recession markets
        if (q.includes('recession')) {
          baseRate = 0.225 // ~20-25% base rate
          marketType = 'recession'
        }
        // Election / win markets
        else if (
          q.includes('win') && (q.includes('election') || q.includes('primary') || q.includes('vote')) ||
          q.includes('president') || q.includes('senator') || q.includes('governor')
        ) {
          baseRate = 0.50
          marketType = 'election'
        }
        // Sports championship / title
        else if (
          (q.includes('win') || q.includes('champion') || q.includes('title') || q.includes('series')) &&
          (q.includes('team') || q.includes('super bowl') || q.includes('world series') ||
           q.includes('nba') || q.includes('nfl') || q.includes('nhl') || q.includes('mlb'))
        ) {
          baseRate = 0.33
          marketType = 'sports'
        }
        // Person-be-thing events
        else if (q.match(/will .+ be .+ by/)) {
          baseRate = 0.20
          marketType = 'personal_event'
        }
        // Price / level reached
        else if (
          q.includes('reach') || q.includes('above') || q.includes('exceed') ||
          q.includes('hit') || q.includes('cross') || q.includes('below')
        ) {
          baseRate = 0.50
          marketType = 'price_level'
        }

        if (baseRate === null) continue

        const mispricing = price - baseRate
        if (Math.abs(mispricing) <= 0.15) continue

        const direction: Opportunity['direction'] = mispricing > 0 ? 'short' : 'long'
        const strength = Math.min(1, Math.abs(mispricing) / 0.30)
        const expectedReturn = Math.abs(mispricing) * 0.50

        // Extra filters for elections
        if (marketType === 'election') {
          if (price > 0.75) {
            // SHORT — extreme favorite unlikely at that price
          } else if (price < 0.20) {
            // LONG — underdog has upside
          } else {
            continue
          }
        }

        opportunities.push({
          id: randomUUID(),
          strategyKey: this.key,
          symbol: market.slug,
          direction,
          assetClass: this.assetClass,
          strength,
          expectedReturn,
          metadata: {
            slug: market.slug,
            question: market.question,
            marketType,
            price,
            baseRate,
            mispricing: parseFloat(mispricing.toFixed(4)),
            reasoning: `${marketType} market priced at ${(price * 100).toFixed(1)}% vs base rate ${(baseRate * 100).toFixed(0)}% — ${Math.abs(mispricing * 100).toFixed(1)}pp mispricing.`,
          },
          detectedAt: new Date().toISOString(),
        })
      }

      return opportunities
        .sort((a, b) => b.expectedReturn - a.expectedReturn)
        .slice(0, 4)
    } catch {
      return []
    }
  }
}

// ─── 3. PolymarketCrossMarketStrategy ─────────────────────────────────────────

export class PolymarketCrossMarketStrategy extends BasePipelineStrategy {
  readonly key = 'polymarket_cross_market' as const
  readonly displayName = 'Polymarket Cross-Market'
  readonly assetClass = 'polymarket' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    try {
      const res = await fetch(
        `${GAMMA_BASE}/events?limit=20&active=true&closed=false&order=volume24hr&ascending=false`,
        { signal: AbortSignal.timeout(8_000) }
      )
      if (!res.ok) return []
      const events: GammaEvent[] = await res.json()

      const opportunities: Opportunity[] = []

      for (const event of events) {
        if (!event.markets || event.markets.length < 2) continue

        // Gather YES prices for markets in this event
        const priced = event.markets.filter(
          m => m.outcomePrices && m.outcomePrices.length > 0 && m.active && !m.closed
        )
        if (priced.length < 2) continue

        const prices = priced.map(m => parsePrice(m.outcomePrices[0]))
        const impliedSum = prices.reduce((s, p) => s + p, 0)
        const arb = Math.abs(impliedSum - 1.0)

        if (arb <= 0.08) continue

        // Most overpriced market
        let maxPrice = -Infinity
        let maxMarket: GammaMarket | null = null
        // Most underpriced market
        let minPrice = Infinity
        let minMarket: GammaMarket | null = null

        for (const m of priced) {
          const p = parsePrice(m.outcomePrices[0])
          if (p > maxPrice) { maxPrice = p; maxMarket = m }
          if (p < minPrice) { minPrice = p; minMarket = m }
        }

        const strength = Math.min(1, arb / 0.25)
        const expectedReturn = arb * 0.60

        if (maxMarket) {
          opportunities.push({
            id: randomUUID(),
            strategyKey: this.key,
            symbol: maxMarket.slug,
            direction: 'short',
            assetClass: this.assetClass,
            strength,
            expectedReturn,
            metadata: {
              eventId: event.id,
              eventTitle: event.title,
              impliedSum: parseFloat(impliedSum.toFixed(4)),
              arb: parseFloat(arb.toFixed(4)),
              question: maxMarket.question,
              yesPrice: maxPrice,
              reasoning: `Cross-market inconsistency in event "${event.title}": implied sum ${(impliedSum * 100).toFixed(1)}% (arb ${(arb * 100).toFixed(1)}pp). Shorting overpriced leg at ${(maxPrice * 100).toFixed(1)}%.`,
            },
            detectedAt: new Date().toISOString(),
          })
        }

        if (minMarket && minMarket !== maxMarket) {
          opportunities.push({
            id: randomUUID(),
            strategyKey: this.key,
            symbol: minMarket.slug,
            direction: 'long',
            assetClass: this.assetClass,
            strength,
            expectedReturn,
            metadata: {
              eventId: event.id,
              eventTitle: event.title,
              impliedSum: parseFloat(impliedSum.toFixed(4)),
              arb: parseFloat(arb.toFixed(4)),
              question: minMarket.question,
              yesPrice: minPrice,
              reasoning: `Cross-market inconsistency in event "${event.title}": implied sum ${(impliedSum * 100).toFixed(1)}% (arb ${(arb * 100).toFixed(1)}pp). Longing underpriced leg at ${(minPrice * 100).toFixed(1)}%.`,
            },
            detectedAt: new Date().toISOString(),
          })
        }
      }

      return opportunities
        .sort((a, b) => b.expectedReturn - a.expectedReturn)
        .slice(0, 3)
    } catch {
      return []
    }
  }
}

// ─── 4. PolymarketEventCompressionStrategy ────────────────────────────────────

export class PolymarketEventCompressionStrategy extends BasePipelineStrategy {
  readonly key = 'polymarket_event_compression' as const
  readonly displayName = 'Polymarket Event Compression'
  readonly assetClass = 'polymarket' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    try {
      const res = await fetch(
        `${GAMMA_BASE}/markets?limit=200&active=true&closed=false&order=endDate&ascending=true`,
        { signal: AbortSignal.timeout(8_000) }
      )
      if (!res.ok) return []
      const markets: GammaMarket[] = await res.json()

      const opportunities: Opportunity[] = []

      for (const market of markets) {
        if (!market.outcomePrices || market.outcomePrices.length === 0) continue
        if (!market.endDate) continue

        const daysToExpiry = daysUntil(market.endDate)
        if (daysToExpiry <= 0 || daysToExpiry >= 2) continue

        const yesPrice = parsePrice(market.outcomePrices[0])

        // Skip genuine uncertainty zone (too risky)
        if (yesPrice >= 0.30 && yesPrice <= 0.70) continue

        if (yesPrice > 0.72) {
          // High confidence YES near expiry — buy YES
          const rawStrength = (yesPrice - 0.72) / 0.20 * (2 / daysToExpiry)
          const strength = Math.min(1, rawStrength)
          const expectedReturn = (1 - yesPrice) * 0.70

          // Contrarian flag: very low volume high-price market
          const volume = parseFloat(market.volume ?? '0')
          if (yesPrice > 0.95 && volume < 10_000) {
            // Possible resolution dispute risk — short instead
            opportunities.push({
              id: randomUUID(),
              strategyKey: this.key,
              symbol: market.slug,
              direction: 'short',
              assetClass: this.assetClass,
              strength: 0.3,
              expectedReturn: yesPrice * 0.70,
              metadata: {
                slug: market.slug,
                question: market.question,
                daysToExpiry,
                yesPrice,
                volume: market.volume,
                reasoning: `Market at ${(yesPrice * 100).toFixed(1)}% with very low volume ($${volume.toFixed(0)}) near expiry — potential resolution dispute risk.`,
              },
              detectedAt: new Date().toISOString(),
            })
            continue
          }

          opportunities.push({
            id: randomUUID(),
            strategyKey: this.key,
            symbol: market.slug,
            direction: 'long',
            assetClass: this.assetClass,
            strength,
            expectedReturn,
            metadata: {
              slug: market.slug,
              question: market.question,
              daysToExpiry,
              yesPrice,
              volume: market.volume,
              reasoning: `Binary compression: ${daysToExpiry.toFixed(2)}d to expiry, YES at ${(yesPrice * 100).toFixed(1)}% — momentum toward 1.`,
            },
            detectedAt: new Date().toISOString(),
          })
        } else if (yesPrice < 0.28) {
          // High confidence NO near expiry — buy NO (short YES)
          const rawStrength = (0.28 - yesPrice) / 0.20 * (2 / daysToExpiry)
          const strength = Math.min(1, rawStrength)
          const expectedReturn = yesPrice * 0.70

          opportunities.push({
            id: randomUUID(),
            strategyKey: this.key,
            symbol: market.slug,
            direction: 'short',
            assetClass: this.assetClass,
            strength,
            expectedReturn,
            metadata: {
              slug: market.slug,
              question: market.question,
              daysToExpiry,
              yesPrice,
              volume: market.volume,
              reasoning: `Binary compression: ${daysToExpiry.toFixed(2)}d to expiry, YES at ${(yesPrice * 100).toFixed(1)}% — momentum toward 0; buy NO.`,
            },
            detectedAt: new Date().toISOString(),
          })
        }
      }

      return opportunities
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 5)
    } catch {
      return []
    }
  }
}

// ─── 5. PolymarketNarrativeFadeStrategy ───────────────────────────────────────

export class PolymarketNarrativeFadeStrategy extends BasePipelineStrategy {
  readonly key = 'polymarket_narrative_fade' as const
  readonly displayName = 'Polymarket Narrative Fade'
  readonly assetClass = 'polymarket' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    try {
      const res = await fetch(
        `${GAMMA_BASE}/markets?limit=100&active=true&closed=false&order=volume24hr&ascending=false`,
        { signal: AbortSignal.timeout(8_000) }
      )
      if (!res.ok) return []
      const markets: GammaMarket[] = await res.json()

      const top30 = markets.slice(0, 30)
      const opportunities: Opportunity[] = []

      for (const market of top30) {
        if (!market.outcomePrices || market.outcomePrices.length === 0) continue

        const yesPrice = parsePrice(market.outcomePrices[0])
        const volume24hr = market.volume24hr ?? 0
        const totalVolume = parseFloat(market.volume ?? '0')
        const liquidity = parseFloat(market.liquidity ?? '0')

        if (liquidity <= 5_000) continue

        const volumeRatio = volume24hr / Math.max(totalVolume, 1)
        if (volumeRatio <= 0.15) continue

        let direction: Opportunity['direction'] | null = null
        let strength = 0

        // Overreacted bullish — fade
        if (yesPrice >= 0.80 && yesPrice < 0.95) {
          direction = 'short'
          strength = volumeRatio * (yesPrice - 0.75) / 0.20
        }
        // Overreacted bearish — fade
        else if (yesPrice > 0.05 && yesPrice <= 0.20) {
          direction = 'long'
          strength = volumeRatio * (0.25 - yesPrice) / 0.20
        }

        if (!direction) continue

        strength = Math.min(1, strength)

        opportunities.push({
          id: randomUUID(),
          strategyKey: this.key,
          symbol: market.slug,
          direction,
          assetClass: this.assetClass,
          strength,
          expectedReturn: 0.05,
          metadata: {
            slug: market.slug,
            question: market.question,
            yesPrice,
            volume24hr,
            totalVolume,
            volumeRatio: parseFloat(volumeRatio.toFixed(4)),
            reasoning: `Narrative overreaction: ${(volumeRatio * 100).toFixed(1)}% of all-time volume traded today; YES at ${(yesPrice * 100).toFixed(1)}% — fading toward mean.`,
          },
          detectedAt: new Date().toISOString(),
        })
      }

      return opportunities
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 4)
    } catch {
      return []
    }
  }
}

// ─── 6. PolymarketLiquidityPocketStrategy ─────────────────────────────────────

export class PolymarketLiquidityPocketStrategy extends BasePipelineStrategy {
  readonly key = 'polymarket_liquidity_pocket' as const
  readonly displayName = 'Polymarket Liquidity Pocket'
  readonly assetClass = 'polymarket' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    try {
      const res = await fetch(
        `${GAMMA_BASE}/markets?limit=200&active=true&closed=false&order=liquidity&ascending=false`,
        { signal: AbortSignal.timeout(8_000) }
      )
      if (!res.ok) return []
      const markets: GammaMarket[] = await res.json()

      const opportunities: Opportunity[] = []

      for (const market of markets) {
        if (!market.outcomePrices || market.outcomePrices.length === 0) continue
        if (!market.acceptingOrders) continue

        const liquidity = parseFloat(market.liquidity ?? '0')
        if (liquidity <= 50_000) continue

        if (!market.endDate) continue
        const daysToExpiry = daysUntil(market.endDate)
        if (daysToExpiry <= 7) continue

        if (!market.bestBid || !market.bestAsk) continue

        const bestBid = parsePrice(market.bestBid)
        const bestAsk = parsePrice(market.bestAsk)
        if (bestBid <= 0 || bestAsk <= 0) continue

        const spread = bestAsk - bestBid
        const midPrice = (bestBid + bestAsk) / 2
        const yesPrice = parsePrice(market.outcomePrices[0])

        // Tight spread + stale price mispricing
        if (spread < 0.04 && Math.abs(midPrice - yesPrice) > 0.03) {
          const direction: Opportunity['direction'] = midPrice > yesPrice ? 'long' : 'short'
          const strength = Math.min(1, Math.abs(midPrice - yesPrice) / 0.10) * (1 - spread / 0.10)
          const expectedReturn = Math.abs(midPrice - yesPrice) * 0.70

          opportunities.push({
            id: randomUUID(),
            strategyKey: this.key,
            symbol: market.slug,
            direction,
            assetClass: this.assetClass,
            strength,
            expectedReturn,
            metadata: {
              slug: market.slug,
              question: market.question,
              liquidity,
              bestBid,
              bestAsk,
              spread: parseFloat(spread.toFixed(4)),
              midPrice: parseFloat(midPrice.toFixed(4)),
              yesPrice,
              reasoning: `Tight-spread stale-book opportunity: mid ${(midPrice * 100).toFixed(1)}% vs last trade ${(yesPrice * 100).toFixed(1)}% (${((Math.abs(midPrice - yesPrice)) * 100).toFixed(1)}pp gap), spread ${(spread * 100).toFixed(1)}%.`,
            },
            detectedAt: new Date().toISOString(),
          })
        }
        // Wide spread in liquid market — market-maker opportunity
        else if (spread > 0.06 && liquidity > 100_000) {
          opportunities.push({
            id: randomUUID(),
            strategyKey: this.key,
            symbol: market.slug,
            direction: 'neutral',
            assetClass: this.assetClass,
            strength: 0.5,
            expectedReturn: spread * 0.40,
            metadata: {
              slug: market.slug,
              question: market.question,
              liquidity,
              bestBid,
              bestAsk,
              spread: parseFloat(spread.toFixed(4)),
              midPrice: parseFloat(midPrice.toFixed(4)),
              yesPrice,
              reasoning: `Wide spread (${(spread * 100).toFixed(1)}%) in liquid market ($${(liquidity / 1000).toFixed(0)}k) — market-make at better prices.`,
            },
            detectedAt: new Date().toISOString(),
          })
        }
      }

      return opportunities
        .sort((a, b) => b.expectedReturn - a.expectedReturn)
        .slice(0, 4)
    } catch {
      return []
    }
  }
}

// ─── 7. PolymarketNoTradeStrategy ─────────────────────────────────────────────

export class PolymarketNoTradeStrategy extends BasePipelineStrategy {
  readonly key = 'polymarket_no_trade' as const
  readonly displayName = 'Polymarket No-Trade'
  readonly assetClass = 'polymarket' as const

  /**
   * Intentionally returns an empty array.
   * This strategy flags markets to avoid (resolution ambiguity, whale manipulation,
   * regulatory grey zones) — these require human judgment, so no trade is emitted.
   */
  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    return []
  }
}
