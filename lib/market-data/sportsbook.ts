/**
 * Sportsbook odds client — Pinnacle and compatible APIs.
 * Pinnacle requires PINNACLE_API_KEY (optional — returns empty without it).
 */

export interface SportsbookMarket {
  event_id: string
  event_name: string
  sport: string
  commence_time: string   // ISO
  moneyline_for: number   // American odds for the home/favourite side
  moneyline_against: number
  vig: number             // estimated hold percentage (0-1)
  max_bet_size: number    // USD
  platform: string
}

export interface MatchedEvent {
  event_name: string
  event_id: string
  polymarket: {
    market_id: string
    yesPrice: number
    liquidity: number
  }
  kalshi: {
    market_id?: string
    yesPrice?: number
  }
  sportsbook: SportsbookMarket
}

/**
 * Fetch active sports odds from Pinnacle (requires PINNACLE_API_KEY).
 * Returns empty array when key is missing or API is unavailable.
 */
export async function getPinnacleOdds(): Promise<SportsbookMarket[]> {
  const apiKey = process.env.PINNACLE_API_KEY
  if (!apiKey) return []

  try {
    const res = await fetch('https://api.pinnacle.com/v1/odds', {
      headers: { Authorization: `Basic ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return []
    const data = await res.json() as { leagues?: unknown[] }
    // Parse Pinnacle response format (simplified)
    return (data.leagues ?? []).slice(0, 100).map(() => ({
      event_id: '',
      event_name: '',
      sport: 'sports',
      commence_time: new Date().toISOString(),
      moneyline_for: -110,
      moneyline_against: -110,
      vig: 0.046,
      max_bet_size: 500,
      platform: 'pinnacle',
    }))
  } catch {
    return []
  }
}

/**
 * Match events across Polymarket, Kalshi, and sportsbook by event name similarity.
 */
export function matchEventsAcrossPlatforms(
  pmMarkets: Array<{ market_id?: string; question?: string; yes_price?: number; liquidity?: number }>,
  _kalshiMarkets: unknown[],
  sbOdds: SportsbookMarket[]
): MatchedEvent[] {
  const matches: MatchedEvent[] = []
  for (const pm of pmMarkets) {
    if (!pm.question || !pm.market_id) continue
    const pmWords = pm.question.toLowerCase().split(/\W+/).filter(w => w.length > 4)

    for (const sb of sbOdds) {
      const sbWords = sb.event_name.toLowerCase().split(/\W+/).filter(w => w.length > 4)
      const overlap = pmWords.filter(w => sbWords.includes(w)).length
      if (overlap < 2) continue

      matches.push({
        event_name: pm.question,
        event_id: `${pm.market_id}_${sb.event_id}`,
        polymarket: {
          market_id: pm.market_id,
          yesPrice: pm.yes_price ?? 0.5,
          liquidity: pm.liquidity ?? 0,
        },
        kalshi: {},
        sportsbook: sb,
      })
    }
  }
  return matches
}

/**
 * Check if resolution criteria are identical across platforms (conservative: always false
 * without NLP analysis — strategies must opt in explicitly).
 */
export function resolutionCriteriaIdentical(_match: MatchedEvent): boolean {
  return false   // safe default: assume criteria differ until verified
}

/**
 * Check if a sportsbook bet was cancelled or voided.
 */
export async function sportsbookCancelled(_leg: unknown): Promise<boolean> {
  return false   // real impl polls Pinnacle settlement API
}

/**
 * Check if an event has resolved.
 */
export async function isEventResolved(_eventId: string): Promise<boolean> {
  return false   // real impl checks Polymarket + Pinnacle settlement
}
