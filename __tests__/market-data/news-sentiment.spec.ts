/**
 * Tests for lib/market-data/news-sentiment.ts
 *
 * 1. getSentimentScore returns DB result when table has recent data
 * 2. getSentimentScore falls back to Yahoo Finance when DB is empty
 * 3. getSentimentScore returns null when both sources fail
 * 4. applySentimentToStrength boosts aligned long + bullish signal
 * 5. applySentimentToStrength dampens contrary long + bearish signal
 * 6. applySentimentToStrength blocks strongly contrary signal (returns null)
 * 7. applySentimentToStrength returns unchanged when sentiment is null
 * 8. applySentimentToStrength is a no-op for neutral direction
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSentimentScore, applySentimentToStrength } from '@/lib/market-data/news-sentiment'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function makeSupabase(rows: unknown[]): SupabaseClient {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    }),
  } as unknown as SupabaseClient
}

function makeEmptySupabase(): SupabaseClient {
  return makeSupabase([])
}

describe('getSentimentScore', () => {
  beforeEach(() => vi.clearAllMocks())

  it('1. returns DB result when table has recent rows', async () => {
    const supabase = makeSupabase([
      { sentiment: 'bullish', score: 0.6, mention_count: 10, source: 'reddit', scraped_at: new Date().toISOString() },
      { sentiment: 'bullish', score: 0.4, mention_count: 5, source: 'x', scraped_at: new Date().toISOString() },
    ])
    const result = await getSentimentScore(supabase, 'META')
    expect(result).not.toBeNull()
    expect(result!.fetchedFromDb).toBe(true)
    expect(result!.sentiment).toBe('bullish')
    expect(result!.score).toBeGreaterThan(0.15)
    expect(result!.sources).toContain('reddit')
    expect(result!.mentionCount).toBe(15)
  })

  it('2. falls back to Yahoo Finance when DB is empty', async () => {
    const supabase = makeEmptySupabase()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        news: [
          { title: 'AMD beats earnings expectations with record revenue' },
          { title: 'AMD surges after strong quarterly results' },
          { title: 'AMD upgraded by analysts on growth outlook' },
        ],
      }),
    } as Response)
    const result = await getSentimentScore(supabase, 'AMD')
    expect(result).not.toBeNull()
    expect(result!.fetchedFromDb).toBe(false)
    expect(result!.sources).toContain('yahoo_finance')
    expect(result!.sentiment).toBe('bullish')
    expect(result!.score).toBeGreaterThan(0)
  })

  it('3. returns null when both DB and Yahoo Finance fail', async () => {
    const supabase = makeEmptySupabase()
    fetchMock.mockResolvedValueOnce({ ok: false } as Response)
    const result = await getSentimentScore(supabase, 'XYZ')
    expect(result).toBeNull()
  })
})

describe('applySentimentToStrength', () => {
  it('4. boosts strength ONLY when ≥2 admitted sources agree (canIncreaseRisk gate)', () => {
    // Two independent admitted sources agreeing → boost allowed.
    const admitted = {
      score: 0.5, sentiment: 'bullish' as const, mentionCount: 10, confidence: 'high' as const,
      sources: ['reuters', 'bloomberg'], admittedSources: ['reuters', 'bloomberg'], fetchedFromDb: true,
    }
    const boosted = applySentimentToStrength(0.6, 'long', admitted)
    expect(boosted).not.toBeNull()
    expect(boosted!).toBeGreaterThan(0.6)
    expect(boosted!).toBeLessThanOrEqual(1.0)
  })

  it('4b. never boosts on a single or unadmitted source — fake headlines cannot increase risk', () => {
    // Single admitted source → no boost.
    const single = {
      score: 0.5, sentiment: 'bullish' as const, mentionCount: 10, confidence: 'high' as const,
      sources: ['reuters'], admittedSources: ['reuters'], fetchedFromDb: true,
    }
    expect(applySentimentToStrength(0.6, 'long', single)).toBe(0.6)

    // Multiple sources, none admitted → no boost.
    const unadmitted = {
      score: 0.5, sentiment: 'bullish' as const, mentionCount: 10, confidence: 'high' as const,
      sources: ['reddit', 'x'], admittedSources: [], fetchedFromDb: true,
    }
    expect(applySentimentToStrength(0.6, 'long', unadmitted)).toBe(0.6)
  })

  it('5. dampens strength when long direction contradicts bearish sentiment', () => {
    const sentiment = { score: -0.3, sentiment: 'bearish' as const, mentionCount: 5, confidence: 'medium' as const, sources: ['reddit'], fetchedFromDb: true }
    const result = applySentimentToStrength(0.6, 'long', sentiment)
    expect(result).not.toBeNull()
    expect(result!).toBeLessThan(0.6)
    expect(result!).toBeCloseTo(0.6 * 0.75, 3)
  })

  it('6. blocks trade (returns null) when sentiment strongly contradicts direction', () => {
    const sentiment = { score: -0.7, sentiment: 'bearish' as const, mentionCount: 20, confidence: 'high' as const, sources: ['reddit'], fetchedFromDb: true }
    const result = applySentimentToStrength(0.8, 'long', sentiment)
    expect(result).toBeNull()
  })

  it('7. returns unchanged strength when sentiment is null', () => {
    const result = applySentimentToStrength(0.7, 'long', null)
    expect(result).toBe(0.7)
  })

  it('8. is a no-op for neutral direction', () => {
    const sentiment = { score: -0.8, sentiment: 'bearish' as const, mentionCount: 50, confidence: 'high' as const, sources: ['reddit'], fetchedFromDb: true }
    const result = applySentimentToStrength(0.5, 'neutral', sentiment)
    expect(result).toBe(0.5)
  })
})
