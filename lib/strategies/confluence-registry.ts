/**
 * ConfluenceRegistry — cross-strategy signal aggregator (TIER 2).
 *
 * Each strategy registers its detected opportunities here. CIODecisionEngine
 * queries this registry to boost or penalise position sizing when multiple
 * strategies agree (or disagree) on the same symbol.
 *
 * Signals older than freshnessMs (1h default) are excluded from consensus.
 * Persistence to Supabase `confluence_signals` is fire-and-forget for
 * cross-instance state (multiple worker replicas).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConfluenceSignal {
  fromStrategyKey: string
  symbol: string
  direction: 'long' | 'short' | 'neutral'
  strength: number     // 0-1
  reasoning?: string
  timestamp: number    // ms since epoch
}

export interface ConfluenceConsensus {
  direction: 'long' | 'short' | 'mixed' | 'none'
  agreementCount: number
  disagreementCount: number
  combinedStrength: number
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export class ConfluenceRegistry {
  private signals = new Map<string, ConfluenceSignal[]>()
  readonly freshnessMs = 60 * 60 * 1_000  // 1h

  register(signal: ConfluenceSignal): void {
    const list = this.signals.get(signal.symbol) ?? []
    // Replace stale signal from the same strategy (idempotent per strategy+symbol)
    const idx = list.findIndex(s => s.fromStrategyKey === signal.fromStrategyKey)
    if (idx >= 0) {
      list[idx] = signal
    } else {
      list.push(signal)
    }
    this.signals.set(signal.symbol, list)
  }

  getSignalsForSymbol(symbol: string): ConfluenceSignal[] {
    const now = Date.now()
    return (this.signals.get(symbol) ?? []).filter(s => now - s.timestamp < this.freshnessMs)
  }

  consensus(symbol: string): ConfluenceConsensus {
    const fresh = this.getSignalsForSymbol(symbol)
    if (fresh.length === 0) {
      return { direction: 'none', agreementCount: 0, disagreementCount: 0, combinedStrength: 0 }
    }

    const longs   = fresh.filter(s => s.direction === 'long')
    const shorts  = fresh.filter(s => s.direction === 'short')
    const combinedStrength = fresh.reduce((sum, s) => sum + s.strength, 0) / fresh.length

    if (longs.length > shorts.length) {
      return {
        direction: 'long',
        agreementCount: longs.length,
        disagreementCount: shorts.length,
        combinedStrength,
      }
    }
    if (shorts.length > longs.length) {
      return {
        direction: 'short',
        agreementCount: shorts.length,
        disagreementCount: longs.length,
        combinedStrength,
      }
    }
    if (longs.length === 0) {
      return { direction: 'none', agreementCount: 0, disagreementCount: 0, combinedStrength: 0 }
    }
    // Tied: mixed
    return {
      direction: 'mixed',
      agreementCount: longs.length,
      disagreementCount: shorts.length,
      combinedStrength,
    }
  }

  /** Async persist to Supabase for cross-instance state. Fire-and-forget — never throws. */
  persistSignal(signal: ConfluenceSignal, supabase: SupabaseClient): void {
    void supabase
      .from('confluence_signals')
      .upsert(
        {
          from_strategy_key: signal.fromStrategyKey,
          symbol: signal.symbol,
          direction: signal.direction,
          strength: signal.strength,
          reasoning: signal.reasoning ?? null,
          created_at: new Date(signal.timestamp).toISOString(),
        },
        { onConflict: 'from_strategy_key,symbol' }
      )
      .then(() => {}, () => {})
  }

  /** Clear all signals — used in tests. */
  clear(): void {
    this.signals.clear()
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const confluenceRegistry = new ConfluenceRegistry()
