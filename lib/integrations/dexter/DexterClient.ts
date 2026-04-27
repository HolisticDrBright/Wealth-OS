/**
 * Dexter SEC Research Client
 *
 * Wraps virattt/dexter (autonomous SEC filing + earnings transcript researcher)
 * as an HTTP sidecar running at DEXTER_URL (default localhost:7433).
 *
 * Every public method gates via FeatureFlagService.canSpend so budget is
 * respected before any external call is made.
 *
 * Audit: docs/external/dexter-audit.md
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { FeatureFlagService } from '@/lib/feature-flags/FeatureFlagService'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SecFiling {
  ticker: string
  form: string          // '10-K', '10-Q', '8-K', 'DEF 14A', etc.
  filedAt: string       // ISO date
  accessionNumber: string
  summary: string
  keyRisks: string[]
  keyOpportunities: string[]
  rawUrl: string
}

export interface EarningsTranscript {
  ticker: string
  quarter: string       // e.g. 'Q1 2026'
  reportedAt: string
  epsSurprise: number | null     // reported - estimated, in dollars
  revenueSurprise: number | null // reported - estimated, in millions
  managementTone: 'positive' | 'neutral' | 'negative'
  guidanceDirection: 'raised' | 'maintained' | 'lowered' | 'none'
  keyQuotes: string[]
  summary: string
}

export interface AnalystReport {
  ticker: string
  analyst: string
  firm: string
  publishedAt: string
  rating: 'buy' | 'overweight' | 'neutral' | 'underweight' | 'sell'
  priceTarget: number | null
  summary: string
}

export interface DexterResponse<T> {
  result: T
  skipped: boolean
  reason?: string
  fetchedAt: string
  cachedUntil?: string
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class DexterClient {
  private readonly baseUrl: string
  private readonly svc: FeatureFlagService
  private readonly userId: string

  constructor(supabase: SupabaseClient, userId: string) {
    this.baseUrl = process.env.DEXTER_URL ?? 'http://localhost:7433'
    this.svc = new FeatureFlagService(supabase)
    this.userId = userId
  }

  /** Fetch and summarise an SEC filing. estCostCents = 5 (one LLM call). */
  async fetchSecFiling(ticker: string, form: string): Promise<DexterResponse<SecFiling | null>> {
    const gate = await this.svc.canSpend(this.userId, 'dexter_research', 5)
    if (!gate.allowed) return { result: null, skipped: true, reason: gate.reason, fetchedAt: new Date().toISOString() }

    try {
      const res = await fetch(`${this.baseUrl}/sec-filing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, form }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return { result: null, skipped: true, reason: `HTTP ${res.status}`, fetchedAt: new Date().toISOString() }
      const data = await res.json() as SecFiling
      await this.svc.logUsage({ userId: this.userId, featureKey: 'dexter_research', operation: 'fetchSecFiling', costCents: 5 })
      return { result: data, skipped: false, fetchedAt: new Date().toISOString() }
    } catch {
      return { result: null, skipped: true, reason: 'dexter sidecar unreachable', fetchedAt: new Date().toISOString() }
    }
  }

  /** Fetch earnings transcript summary and key metrics. estCostCents = 5. */
  async fetchEarningsTranscript(ticker: string, quarter: string): Promise<DexterResponse<EarningsTranscript | null>> {
    const gate = await this.svc.canSpend(this.userId, 'dexter_research', 5)
    if (!gate.allowed) return { result: null, skipped: true, reason: gate.reason, fetchedAt: new Date().toISOString() }

    try {
      const res = await fetch(`${this.baseUrl}/earnings-transcript`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, quarter }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return { result: null, skipped: true, reason: `HTTP ${res.status}`, fetchedAt: new Date().toISOString() }
      const data = await res.json() as EarningsTranscript
      await this.svc.logUsage({ userId: this.userId, featureKey: 'dexter_research', operation: 'fetchEarningsTranscript', costCents: 5 })
      return { result: data, skipped: false, fetchedAt: new Date().toISOString() }
    } catch {
      return { result: null, skipped: true, reason: 'dexter sidecar unreachable', fetchedAt: new Date().toISOString() }
    }
  }

  /** Fetch analyst consensus reports for a ticker. estCostCents = 3. */
  async fetchAnalystReports(ticker: string): Promise<DexterResponse<AnalystReport[]>> {
    const gate = await this.svc.canSpend(this.userId, 'dexter_research', 3)
    if (!gate.allowed) return { result: [], skipped: true, reason: gate.reason, fetchedAt: new Date().toISOString() }

    try {
      const res = await fetch(`${this.baseUrl}/analyst-reports/${encodeURIComponent(ticker)}`, {
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return { result: [], skipped: true, reason: `HTTP ${res.status}`, fetchedAt: new Date().toISOString() }
      const data = await res.json() as AnalystReport[]
      await this.svc.logUsage({ userId: this.userId, featureKey: 'dexter_research', operation: 'fetchAnalystReports', costCents: 3 })
      return { result: data, skipped: false, fetchedAt: new Date().toISOString() }
    } catch {
      return { result: [], skipped: true, reason: 'dexter sidecar unreachable', fetchedAt: new Date().toISOString() }
    }
  }

  /** Ping the sidecar to check reachability. */
  static async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const url = process.env.DEXTER_URL ?? 'http://localhost:7433'
    const start = Date.now()
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3_000) })
      return { ok: res.ok, latencyMs: Date.now() - start }
    } catch {
      return { ok: false, latencyMs: Date.now() - start }
    }
  }
}
