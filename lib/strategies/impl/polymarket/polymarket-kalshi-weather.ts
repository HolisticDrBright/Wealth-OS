/**
 * Polymarket + Kalshi Weather Strategy
 * Edge: information (#edge/information)
 * Asset: polymarket -> Polymarket CLOB + Kalshi
 * AI Confluence: MiroFish=medium, Kronos=skip
 *
 * Trades weather prediction markets when ensemble model probability
 * deviates from implied market probability by >= 8 cents, with
 * ensemble agreement >= 0.70 and spread < edge captured.
 *
 * Data: Open-Meteo ensemble API (free, no key).
 * Markets: Polymarket weather events + Kalshi KXHIGH series.
 * Cadence: every 15 min, synced with GFS releases at 00/06/12/18 UTC.
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
import { getRiskControl, getPortfolioUsd, quarterKelly, applyConfluenceHaircut } from '../../risk-controls'
import {
  getConsensus,
} from '@/lib/integrations/weather/WeatherEnsembleClient'
import type { SupabaseClient } from '@supabase/supabase-js'

// --- Thresholds ---------------------------------------------------------------

const MIN_EDGE_CENTS        = 0.08   // 8 cents minimum deviation to enter
const MIN_AGREEMENT         = 0.70   // ensemble agreement >= 70%
const MAX_SPREAD_FRACTION   = 0.85   // spread must be < 85% of edge
const MIN_HOURS_TO_RESOLVE  = 6      // close out 6h before resolution
const HARD_EXIT_MINUTES     = 15     // hard exit 15min before resolution
const MAX_SIMULTANEOUS      = 4
const TRADE_RISK_PCT        = 0.01   // 1% per trade

// GFS releases: 00, 06, 12, 18 UTC; ECMWF: 00, 12 UTC
// Allow 90 min for data dissemination
function isNearModelRelease(): boolean {
  const h = new Date().getUTCHours()
  const m = new Date().getUTCMinutes()
  const minuteOfDay = h * 60 + m
  const releases = [0, 90, 6 * 60, 6 * 60 + 90, 12 * 60, 12 * 60 + 90, 18 * 60, 18 * 60 + 90]
  return releases.some(r => minuteOfDay >= r && minuteOfDay < r + 90)
}

const GAMMA_BASE = 'https://gamma-api.polymarket.com'

interface WeatherMarket {
  conditionId: string
  question: string
  endDate: string
  yesPrice: number
  noPrice: number
  spread: number
  liquidity: number
  // Extracted from question
  lat?: number
  lon?: number
  threshold?: number
  variable?: 'temperature_2m_max' | 'precipitation_sum' | 'wind_speed_10m_max'
  targetDate?: string
  platform: 'polymarket' | 'kalshi'
}

/** Parse temperature threshold and location from a Polymarket weather question. */
function parseWeatherQuestion(question: string, endDate: string): {
  lat: number; lon: number; threshold: number;
  variable: 'temperature_2m_max' | 'precipitation_sum' | 'wind_speed_10m_max';
  targetDate: string
} | null {
  // Example: "Will the high temperature in NYC exceed 70F on April 28?"
  // This is a simplified parser; production would use a more robust approach
  const tempMatch = question.match(/(\d+)F/i)
  const precipMatch = question.match(/rain|precipitation|inches?/i)

  if (!tempMatch && !precipMatch) return null

  // City -> lat/lon lookup (production would use geocoding API)
  const cityCoords: Record<string, [number, number]> = {
    'NYC': [40.71, -74.01], 'New York': [40.71, -74.01],
    'LA': [34.05, -118.24], 'Los Angeles': [34.05, -118.24],
    'Chicago': [41.88, -87.63],
    'Houston': [29.76, -95.37],
    'Philadelphia': [39.95, -75.17],
    'Phoenix': [33.45, -112.07],
    'San Antonio': [29.42, -98.49],
    'San Diego': [32.72, -117.15],
    'Dallas': [32.78, -96.80],
    'Jacksonville': [30.33, -81.66],
    'Austin': [30.27, -97.74],
    'San Francisco': [37.77, -122.42], 'SF': [37.77, -122.42],
    'Columbus': [39.96, -82.99],
    'Charlotte': [35.23, -80.84],
    'Indianapolis': [39.77, -86.16],
    'Seattle': [47.61, -122.33],
    'Denver': [39.74, -104.99],
    'Nashville': [36.17, -86.78],
    'Oklahoma City': [35.47, -97.52],
    'Las Vegas': [36.17, -115.14],
    'Washington': [38.91, -77.04], 'DC': [38.91, -77.04],
    'Memphis': [35.15, -90.05],
    'Louisville': [38.25, -85.76],
    'Portland': [45.52, -122.68],
    'Baltimore': [39.29, -76.61],
    'Milwaukee': [43.04, -87.91],
    'Albuquerque': [35.08, -106.65],
    'Atlanta': [33.75, -84.39],
    'Boston': [42.36, -71.06],
    'Miami': [25.77, -80.19],
    'Minneapolis': [44.98, -93.27],
    'New Orleans': [29.95, -90.07],
    'Tampa': [27.95, -82.46],
    'Raleigh': [35.78, -78.64],
    'Cleveland': [41.50, -81.69],
    'Kansas City': [39.10, -94.58],
    'Detroit': [42.33, -83.05],
    'Pittsburgh': [40.44, -79.99],
    'Salt Lake City': [40.76, -111.89],
    'Richmond': [37.54, -77.43],
    'London': [51.51, -0.13],
    'Paris': [48.85, 2.35],
    'Tokyo': [35.68, 139.69],
    'Sydney': [-33.87, 151.21],
  }

  let lat = 40.71
  let lon = -74.01
  for (const [city, coords] of Object.entries(cityCoords)) {
    if (question.includes(city)) {
      ;[lat, lon] = coords
      break
    }
  }

  // Target date from endDate (proxy for the day of the weather event)
  const targetDate = new Date(endDate).toISOString().split('T')[0]

  if (precipMatch) {
    const inches = question.match(/(\d+(?:\.\d+)?)\s*inch/i)
    const threshold = inches ? parseFloat(inches[1]) * 25.4 : 25  // mm
    return { lat, lon, threshold, variable: 'precipitation_sum', targetDate }
  }

  const thresholdF = parseFloat(tempMatch![1])
  const thresholdC = (thresholdF - 32) * 5 / 9
  return { lat, lon, threshold: thresholdC, variable: 'temperature_2m_max', targetDate }
}

/** Fetch active weather markets from Polymarket. */
async function fetchPolymarketWeatherMarkets(): Promise<WeatherMarket[]> {
  const keywords = ['temperature', 'weather', 'rain', 'precipitation', 'snow', 'wind', 'hurricane', 'tornado']
  const seen = new Set<string>()
  const markets: WeatherMarket[] = []

  await Promise.allSettled(keywords.map(async (kw) => {
    try {
      const res = await fetch(
        `${GAMMA_BASE}/markets?active=true&closed=false&limit=30&keyword=${kw}&order=volumeNum`,
        { signal: AbortSignal.timeout(8_000) }
      )
      if (!res.ok) return

      const data = await res.json() as Array<{
        conditionId: string; question: string; endDate: string;
        outcomePrices: string[]; liquidity: string; bestBid: string; bestAsk: string;
      }>

      for (const m of data) {
        if (seen.has(m.conditionId)) continue
        seen.add(m.conditionId)
        const yes = parseFloat(m.outcomePrices?.[0] ?? '0.5')
        const no  = parseFloat(m.outcomePrices?.[1] ?? '0.5')
        const bid = parseFloat(m.bestBid ?? '0')
        const ask = parseFloat(m.bestAsk ?? '1')
        const liquidity = parseFloat(m.liquidity ?? '0')
        if (liquidity < 5_000) continue
        markets.push({
          conditionId: m.conditionId,
          question: m.question,
          endDate: m.endDate,
          yesPrice: yes,
          noPrice: no,
          spread: ask - bid,
          liquidity,
          platform: 'polymarket' as const,
        })
      }
    } catch { /* skip failed keyword */ }
  }))

  return markets
}

export class PolymarketKalshiWeatherStrategy extends BasePipelineStrategy {
  readonly key = 'polymarket_kalshi_weather' as const
  readonly displayName = 'Polymarket + Kalshi Weather'
  readonly assetClass = 'polymarket' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    // Cadence: only run near GFS/ECMWF release windows
    if (!isNearModelRelease()) return []

    const weatherMarkets = await fetchPolymarketWeatherMarkets()
    if (weatherMarkets.length === 0) return []

    const opportunities: Opportunity[] = []

    for (const mkt of weatherMarkets) {
      if (opportunities.length >= MAX_SIMULTANEOUS) break

      // Parse weather parameters from question
      const params = parseWeatherQuestion(mkt.question, mkt.endDate)
      if (!params) continue

      const hoursLeft = (new Date(mkt.endDate).getTime() - Date.now()) / 3_600_000
      if (hoursLeft < MIN_HOURS_TO_RESOLVE) continue
      if (hoursLeft / 60 < HARD_EXIT_MINUTES / 60) continue

      // Fetch ensemble consensus
      const consensus = await getConsensus(
        params.lat, params.lon,
        params.variable,
        params.targetDate,
        params.threshold
      )

      if (consensus.agreementScore < MIN_AGREEMENT) continue
      if (consensus.fairProb === 0 || consensus.fairProb === 1) continue

      // Compare fair probability to implied market probability
      const impliedProb = mkt.yesPrice
      const edge = Math.abs(consensus.fairProb - impliedProb)

      if (edge < MIN_EDGE_CENTS) continue
      if (mkt.spread >= edge * MAX_SPREAD_FRACTION) continue

      const direction = consensus.fairProb > impliedProb ? 'long' : 'short'
      const strength = Math.min(0.9, (edge - MIN_EDGE_CENTS) / 0.10 * 0.5 + consensus.agreementScore * 0.4)
      const expectedReturn = edge * 0.6  // capture 60% of the theoretical edge

      opportunities.push({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: `POLY:${mkt.conditionId}`,
        direction,
        assetClass: this.assetClass,
        strength,
        expectedReturn,
        metadata: {
          conditionId: mkt.conditionId,
          question: mkt.question,
          endDate: mkt.endDate,
          hoursLeft,
          platform: mkt.platform,
          impliedProb,
          fairProb: consensus.fairProb,
          edgeCents: edge,
          agreementScore: consensus.agreementScore,
          variable: params.variable,
          threshold: params.threshold,
          targetDate: params.targetDate,
          lat: params.lat,
          lon: params.lon,
          spread: mkt.spread,
          liquidity: mkt.liquidity,
          hardExitMinutes: HARD_EXIT_MINUTES,
          reasoning: `Weather model: fair=${(consensus.fairProb * 100).toFixed(1)}% vs implied=${(impliedProb * 100).toFixed(1)}%, edge=${(edge * 100).toFixed(1)}c, agreement=${(consensus.agreementScore * 100).toFixed(0)}%`,
        },
        detectedAt: new Date().toISOString(),
      })
    }

    return opportunities
  }

  async runRedTeam(opp: Opportunity): Promise<RedTeamVerdict> {
    const edge      = opp.metadata.edgeCents as number
    const agreement = opp.metadata.agreementScore as number
    const spread    = opp.metadata.spread as number

    if (edge < MIN_EDGE_CENTS) {
      return { passed: false, score: 15, reason: `Edge ${(edge * 100).toFixed(1)}c < ${MIN_EDGE_CENTS * 100}c minimum` }
    }
    if (agreement < MIN_AGREEMENT) {
      return { passed: false, score: 20, reason: `Ensemble agreement ${(agreement * 100).toFixed(0)}% < ${MIN_AGREEMENT * 100}% required` }
    }
    if (spread >= edge) {
      return { passed: false, score: 10, reason: `Spread ${(spread * 100).toFixed(1)}c >= edge ${(edge * 100).toFixed(1)}c` }
    }

    // Opposing case: weather models can be wrong; binary resolution is all-or-nothing
    const baseScore = Math.min(100,
      opp.strength * 50 +
      Math.min(25, (edge - MIN_EDGE_CENTS) / 0.10 * 25) +
      Math.min(25, (agreement - MIN_AGREEMENT) / 0.30 * 25)
    )

    return {
      passed: baseScore >= 35,
      score: baseScore,
      reason: baseScore < 35 ? `Weather red-team score ${baseScore.toFixed(0)} -- edge or agreement marginal` : undefined,
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
    const maxSinglePct = rc?.max_single_position_pct ?? 5

    const edge = opp.metadata.edgeCents as number
    const qk = quarterKelly(opp.strength, edge / 0.02)
    let fraction = Math.min(qk, TRADE_RISK_PCT, maxSinglePct / 100)
    fraction = applyConfluenceHaircut(fraction, verdicts.mirofish?.score ?? null, verdicts.kronos?.pass ?? null)
    fraction = Math.max(fraction, 0.003)

    const notionalUsd = fraction * portfolio

    return {
      fraction,
      notionalUsd,
      rationale: `QK=${(qk * 100).toFixed(1)}% weather edge=${((opp.metadata.edgeCents as number) * 100).toFixed(1)}c agreement=${((opp.metadata.agreementScore as number) * 100).toFixed(0)}%`,
    }
  }
}
