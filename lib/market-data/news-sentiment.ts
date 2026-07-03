/**
 * News sentiment helper.
 *
 * Priority:
 *   1. news_sentiment table (populated by Camofox cron — Reddit/X)
 *   2. Yahoo Finance news headlines (free, no key, always available)
 *
 * Returns a SentimentResult with a score in [-1, +1]:
 *   > +0.15 = bullish  |  < -0.15 = bearish  |  otherwise neutral
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { canIncreaseRisk } from '@/lib/ingest/sanitize'

export interface SentimentResult {
  score: number                             // -1.0 to +1.0
  sentiment: 'bullish' | 'bearish' | 'neutral'
  mentionCount: number
  confidence: 'high' | 'medium' | 'low'
  sources: string[]
  /** Subset of `sources` that are admitted-on-evidence in source_scores. */
  admittedSources?: string[]
  fetchedFromDb: boolean
}

// ─── Keyword lists ────────────────────────────────────────────────────────────

const BULLISH = [
  'beat', 'beats', 'surge', 'surges', 'record', 'upgrade', 'upgraded',
  'raised', 'bullish', 'breakout', 'outperform', 'strong', 'growth',
  'profit', 'revenue', 'buy', 'positive', 'gains', 'rally', 'tops',
  'exceeds', 'above expectations', 'blowout', 'momentum', 'accelerating',
]

const BEARISH = [
  'miss', 'misses', 'missed', 'plunge', 'plunges', 'downgrade', 'downgraded',
  'cut', 'cuts', 'bearish', 'breakdown', 'underperform', 'weak', 'loss',
  'decline', 'declines', 'sell', 'negative', 'falls', 'drops', 'below',
  'warning', 'concern', 'disappoints', 'slowing', 'layoffs', 'lawsuit',
]

function scoreText(text: string): number {
  const lower = text.toLowerCase()
  const bull = BULLISH.filter(w => lower.includes(w)).length
  const bear = BEARISH.filter(w => lower.includes(w)).length
  const total = bull + bear
  if (total === 0) return 0
  return (bull - bear) / total
}

// ─── DB source (Camofox-populated) ───────────────────────────────────────────

async function getDbSentiment(
  supabase: SupabaseClient,
  ticker: string,
  maxAgeHours: number
): Promise<SentimentResult | null> {
  const since = new Date(Date.now() - maxAgeHours * 3_600_000).toISOString()
  const { data } = await supabase
    .from('news_sentiment')
    .select('sentiment, score, mention_count, source, scraped_at')
    .eq('symbol', ticker)
    .gte('scraped_at', since)
    .order('scraped_at', { ascending: false })
    .limit(20)

  if (!data || data.length === 0) return null

  // Recency-weighted average: half-life = 6h, weight also scales with mention count
  let weightedScore = 0
  let totalWeight = 0
  const sources = new Set<string>()
  let totalMentions = 0

  for (const row of data) {
    const ageMs = Date.now() - new Date(row.scraped_at as string).getTime()
    const recencyWeight = Math.exp(-ageMs / (6 * 3_600_000))
    const mentionWeight = Math.max(1, row.mention_count as number)
    const weight = recencyWeight * mentionWeight
    weightedScore += (row.score as number) * weight
    totalWeight += weight
    sources.add(row.source as string)
    totalMentions += row.mention_count as number
  }

  const score = totalWeight > 0 ? Math.max(-1, Math.min(1, weightedScore / totalWeight)) : 0

  // Which of these sources are admitted-on-evidence? (fail-closed: none)
  let admittedSources: string[] = []
  try {
    const { data: scores } = await supabase
      .from('source_scores')
      .select('source_id, admitted')
      .in('source_id', [...sources])
    admittedSources = ((scores ?? []) as Array<{ source_id: string; admitted: boolean }>)
      .filter(s => s.admitted)
      .map(s => s.source_id)
  } catch { /* table missing → no source is admitted */ }

  return {
    score,
    sentiment: score > 0.15 ? 'bullish' : score < -0.15 ? 'bearish' : 'neutral',
    mentionCount: totalMentions,
    confidence: data.length >= 5 ? 'high' : data.length >= 2 ? 'medium' : 'low',
    sources: [...sources],
    admittedSources,
    fetchedFromDb: true,
  }
}

// ─── Yahoo Finance fallback ───────────────────────────────────────────────────

async function getYahooNewsSentiment(ticker: string): Promise<SentimentResult | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=10&enableFuzzyQuery=false&quotesCount=0`,
      { signal: AbortSignal.timeout(5_000) }
    )
    if (!res.ok) return null

    const data = await res.json() as { news?: Array<{ title: string }> }
    const articles = data.news ?? []
    if (articles.length === 0) return null

    const scores = articles.map(a => scoreText(a.title))
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length
    const score = Math.max(-1, Math.min(1, avg))

    return {
      score,
      sentiment: score > 0.15 ? 'bullish' : score < -0.15 ? 'bearish' : 'neutral',
      mentionCount: articles.length,
      confidence: articles.length >= 6 ? 'medium' : 'low',
      sources: ['yahoo_finance'],
      fetchedFromDb: false,
    }
  } catch {
    return null
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get sentiment for a ticker.
 * Tries DB first (rich Reddit/X data), falls back to Yahoo Finance headlines.
 * Returns null if both sources fail — callers should treat null as "no opinion".
 */
export async function getSentimentScore(
  supabase: SupabaseClient | undefined,
  ticker: string,
  maxAgeHours = 24
): Promise<SentimentResult | null> {
  if (supabase) {
    const db = await getDbSentiment(supabase, ticker, maxAgeHours)
    if (db) return db
  }
  return getYahooNewsSentiment(ticker)
}

/**
 * Apply a sentiment score as a strength multiplier.
 *
 * Rules:
 *   - Aligned (gap dir matches sentiment): boost ×1.3, capped at 1.0 —
 *     ONLY when ≥2 independent ADMITTED sources agree (canIncreaseRisk).
 *     Risk-reducing effects (dampen/block) never require admission.
 *   - Neutral sentiment: no change
 *   - Contrary (moderate bearish vs long gap): dampen ×0.75
 *   - Strongly contrary (score ≤ -0.4 vs long, or ≥ +0.4 vs short): return null to block
 *
 * Returns null to signal "block this trade".
 */
export function applySentimentToStrength(
  strength: number,
  direction: 'long' | 'short' | 'neutral',
  sentiment: SentimentResult | null
): number | null {
  if (!sentiment || direction === 'neutral') return strength
  // Only use sentiment when we have at least low confidence
  if (sentiment.mentionCount < 2 && sentiment.confidence === 'low') return strength

  const s = sentiment.score
  const isLong  = direction === 'long'
  const aligned  = (isLong && s > 0.15) || (!isLong && s < -0.15)
  const contrary = (isLong && s < -0.15) || (!isLong && s > 0.15)
  const strong   = (isLong && s <= -0.40) || (!isLong && s >= 0.40)

  if (strong && sentiment.confidence !== 'low') return null   // block
  if (contrary) return strength * 0.75
  if (aligned) {
    // Boosting exposure on external text requires the assembly gate: ≥2
    // distinct admitted sources agreeing on direction. Fake headlines from a
    // single (or unadmitted) source can never INCREASE risk.
    const admitted = new Set(sentiment.admittedSources ?? [])
    const gate = canIncreaseRisk(sentiment.sources.map(src => ({
      source_id: src,
      direction: (isLong ? 1 : -1) as 1 | -1,
      sourceAdmitted: admitted.has(src),
    })))
    if (!gate.allowed) return strength   // no boost — but no penalty either
    return Math.min(1, strength * 1.30)
  }
  return strength
}
