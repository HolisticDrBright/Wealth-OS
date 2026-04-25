/**
 * sync-news-sentiment — Reddit + X.com sentiment scraper.
 *
 * Uses Camofox to scrape Reddit (r/stocks, r/wallstreetbets, r/investing,
 * r/CryptoCurrency) and X.com cashtag search for ticker mentions.
 *
 * Results are written to public.news_sentiment.
 * Gated by: camofox_scraping feature flag.
 *
 * Run via cron or POST /api/cron/sync-news-sentiment
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { CamofoxClient } from '@/lib/integrations/camofox/CamofoxClient'

const REDDIT_SUBS = ['stocks', 'wallstreetbets', 'investing', 'CryptoCurrency']
const SENTIMENT_KEYWORDS = {
  bullish: ['bullish', 'long', 'buy', 'moon', 'breakout', 'calls', 'squeeze', 'undervalued'],
  bearish: ['bearish', 'short', 'sell', 'dump', 'puts', 'overvalued', 'crash', 'bubble'],
}

export interface SyncSentimentResult {
  postsScraped: number
  rowsUpserted: number
  symbolsFound: string[]
  errors: string[]
}

export async function runSyncNewsSentiment(
  supabase: SupabaseClient,
  userId: string,
  symbols: string[] = []
): Promise<SyncSentimentResult> {
  const camofox = new CamofoxClient(supabase, userId)
  const errors: string[] = []
  let postsScraped = 0
  const allRows: SentimentRow[] = []
  const symbolsFound = new Set<string>()

  // ── Reddit hot posts ──────────────────────────────────────────────────────
  for (const sub of REDDIT_SUBS) {
    const res = await camofox.getPageText(`https://old.reddit.com/r/${sub}/hot.json?limit=25`)
    if (res.skipped) {
      errors.push(`reddit/${sub}: ${res.reason}`)
      continue
    }

    const posts = parseRedditText(res.result.text, symbols)
    postsScraped += posts.length
    for (const p of posts) symbolsFound.add(p.symbol)
    allRows.push(...posts)
  }

  // ── X.com cashtag search for user-specified symbols ───────────────────────
  for (const sym of symbols.slice(0, 5)) {
    const res = await camofox.getPageText(`https://twitter.com/search?q=%24${sym}&src=typed_query&f=live`)
    if (res.skipped) {
      errors.push(`x/${sym}: ${res.reason}`)
      continue
    }
    const posts = parseTweetText(res.result.text, sym)
    postsScraped += posts.length
    if (posts.length > 0) symbolsFound.add(sym)
    allRows.push(...posts)
  }

  // ── Upsert to DB ──────────────────────────────────────────────────────────
  let rowsUpserted = 0
  if (allRows.length > 0) {
    const { data, error } = await supabase
      .from('news_sentiment')
      .insert(allRows)
      .select('id')
    if (error) errors.push(`db_upsert: ${error.message}`)
    rowsUpserted = data?.length ?? 0
  }

  return {
    postsScraped,
    rowsUpserted,
    symbolsFound: Array.from(symbolsFound),
    errors,
  }
}

// ─── Types + parsers ──────────────────────────────────────────────────────────

interface SentimentRow {
  symbol: string
  source: 'reddit' | 'x'
  title: string | null
  body: string | null
  sentiment: 'bullish' | 'bearish' | 'neutral'
  score: number
  mention_count: number
  scraped_at: string
}

const TICKER_RE = /\b([A-Z]{2,5})\b/g

function scoreSentiment(text: string): { sentiment: 'bullish' | 'bearish' | 'neutral'; score: number } {
  const lower = text.toLowerCase()
  const bull = SENTIMENT_KEYWORDS.bullish.filter(w => lower.includes(w)).length
  const bear = SENTIMENT_KEYWORDS.bearish.filter(w => lower.includes(w)).length
  const score = (bull - bear) / Math.max(1, bull + bear)
  return {
    sentiment: score > 0.1 ? 'bullish' : score < -0.1 ? 'bearish' : 'neutral',
    score: Math.round(score * 100) / 100,
  }
}

function parseRedditText(text: string, filterSymbols: string[]): SentimentRow[] {
  const rows: SentimentRow[] = []
  const mentions = new Map<string, number>()

  // Count ticker mentions in the text
  let m: RegExpExecArray | null
  while ((m = TICKER_RE.exec(text)) !== null) {
    const sym = m[1]
    // Filter obvious false-positives (common English words)
    if (sym.length < 2 || ['THE', 'AND', 'FOR', 'NOT', 'ARE', 'BUT', 'OR', 'AN', 'IN', 'AT', 'ON', 'IT', 'IS', 'BE', 'AS', 'BY', 'WE', 'MY', 'AM', 'AI', 'DD', 'US', 'TO', 'UP', 'OP'].includes(sym)) continue
    if (filterSymbols.length > 0 && !filterSymbols.includes(sym)) continue
    mentions.set(sym, (mentions.get(sym) ?? 0) + 1)
  }

  for (const [symbol, count] of mentions.entries()) {
    const { sentiment, score } = scoreSentiment(text)
    rows.push({
      symbol,
      source: 'reddit',
      title: null,
      body: text.slice(0, 500),
      sentiment,
      score,
      mention_count: count,
      scraped_at: new Date().toISOString(),
    })
  }

  return rows
}

function parseTweetText(text: string, symbol: string): SentimentRow[] {
  const { sentiment, score } = scoreSentiment(text)
  const count = (text.match(new RegExp(`\\$${symbol}`, 'g')) ?? []).length
  if (count === 0) return []
  return [{
    symbol,
    source: 'x',
    title: null,
    body: text.slice(0, 500),
    sentiment,
    score,
    mention_count: count,
    scraped_at: new Date().toISOString(),
  }]
}
