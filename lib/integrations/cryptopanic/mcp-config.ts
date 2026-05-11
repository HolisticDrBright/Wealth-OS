/**
 * CryptoPanic MCP integration — narrative heat scoring.
 *
 * Wraps the CryptoPanic REST API to compute narrative heat scores and top movers.
 * Used by: narrative_rotation strategy (see stubs.ts TODO)
 * MCP server: npx @kukapay/cryptopanic-mcp-server  (wired in .mcp.json)
 * API key:    CRYPTOPANIC_API_KEY env var  (free tier at cryptopanic.com/developers/api/)
 *
 * All calls are cached for 60 seconds to stay within free-tier rate limits.
 */

const BASE_URL = 'https://cryptopanic.com/api/v1'
const CACHE_TTL_MS = 60_000

interface CacheEntry { data: unknown; ts: number }
const CACHE = new Map<string, CacheEntry>()

async function fetchCached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = CACHE.get(key)
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data as T
  const data = await fetcher()
  CACHE.set(key, { data, ts: Date.now() })
  return data
}

/** Clear the in-memory cache (useful in tests). */
export function clearCache(): void { CACHE.clear() }

export type Lookback = '1h' | '24h' | '7d'

interface CpVotes {
  negative: number; positive: number; important: number
  liked: number; disliked: number; lol: number; toxic: number; saved: number; comments: number
}
interface CpPost { title: string; votes: CpVotes; currencies?: Array<{ code: string }> }
interface CpResponse { count: number; results: CpPost[] }

export interface NarrativeHeatResult {
  score:    number  // 0–100:  (symbolPosts/globalPosts × 50) + (polarity × 50)
  posts:    number
  polarity: number  // –1 to +1: (bullish – bearish) / total
}

/**
 * Compute a 0–100 heat score for a single symbol over the given lookback window.
 *
 *   polarity = (bullish_posts – bearish_posts) / total_posts
 *   score    = (symbolPosts / globalPosts × 50) + (polarity × 50), clamped to [0, 100]
 *
 * A post is "bullish" when positive votes > negative votes, "bearish" otherwise.
 */
export async function narrativeHeatScore(
  symbol: string,
  lookback: Lookback,
): Promise<NarrativeHeatResult> {
  const apiKey = process.env.CRYPTOPANIC_API_KEY
  if (!apiKey) return { score: 0, posts: 0, polarity: 0 }

  return fetchCached(`heat:${symbol}:${lookback}`, async () => {
    const [symRes, globalRes] = await Promise.all([
      fetch(`${BASE_URL}/posts/?auth_token=${apiKey}&currencies=${symbol}&public=true&filter=hot&period=${lookback}`, {
        signal: AbortSignal.timeout(8_000),
      }),
      fetch(`${BASE_URL}/posts/?auth_token=${apiKey}&public=true&filter=hot&period=${lookback}`, {
        signal: AbortSignal.timeout(8_000),
      }),
    ])
    if (!symRes.ok || !globalRes.ok) return { score: 0, posts: 0, polarity: 0 }

    const [symData, globalData] = await Promise.all([
      symRes.json() as Promise<CpResponse>,
      globalRes.json() as Promise<CpResponse>,
    ])

    const posts = symData.count ?? 0
    const globalPosts = Math.max(1, globalData.count ?? 1)
    const results = symData.results ?? []

    let bullish = 0, bearish = 0
    for (const post of results) {
      if (post.votes.positive > post.votes.negative) bullish++
      else if (post.votes.negative > post.votes.positive) bearish++
    }
    const total = results.length
    const polarity = total > 0 ? (bullish - bearish) / total : 0
    const score = Math.min(100, Math.max(0, (posts / globalPosts) * 50 + polarity * 50))

    return { score, posts, polarity }
  })
}

export interface MoverResult {
  symbol:   string
  score:    number
  polarity: number
  headline: string
}

/**
 * Return the top 10 symbols by narrative heat, sorted by score descending.
 */
export async function topMovers(lookback: Lookback): Promise<MoverResult[]> {
  const apiKey = process.env.CRYPTOPANIC_API_KEY
  if (!apiKey) return []

  return fetchCached(`movers:${lookback}`, async () => {
    const res = await fetch(
      `${BASE_URL}/posts/?auth_token=${apiKey}&public=true&filter=hot&period=${lookback}`,
      { signal: AbortSignal.timeout(8_000) },
    )
    if (!res.ok) return []

    const data = await res.json() as CpResponse
    const results = data.results ?? []

    const bySymbol = new Map<string, { bullish: number; bearish: number; total: number; headline: string }>()
    for (const post of results) {
      for (const currency of post.currencies ?? []) {
        const sym = currency.code.toUpperCase()
        const entry = bySymbol.get(sym) ?? { bullish: 0, bearish: 0, total: 0, headline: post.title }
        entry.total++
        if (post.votes.positive > post.votes.negative) entry.bullish++
        else if (post.votes.negative > post.votes.positive) entry.bearish++
        bySymbol.set(sym, entry)
      }
    }

    const globalPosts = Math.max(1, results.length)
    return Array.from(bySymbol.entries())
      .map(([symbol, { bullish, bearish, total, headline }]) => {
        const polarity = total > 0 ? (bullish - bearish) / total : 0
        const score = Math.min(100, Math.max(0, (total / globalPosts) * 50 + polarity * 50))
        return { symbol, score, polarity, headline }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
  })
}
