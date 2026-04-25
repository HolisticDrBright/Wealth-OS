/**
 * sync-kronos — per-user nightly Kronos forecast worker.
 *
 * Designed to run nightly at 02:00 UTC (via Vercel Cron or an external scheduler
 * calling POST /api/cron/sync-kronos). Adapts the BullMQ pattern from the prompt
 * to a plain async function that can be called from any HTTP handler or test.
 *
 * Flow per user:
 *   1. Fetch their watchlist symbols + open positions
 *   2. For each symbol, look up which strategy keys apply (stored in user_positions
 *      or defaulted from asset class)
 *   3. Only proceed where STRATEGY_REGISTRY_CONFIG[strategyKey].kronos ∈ ['high', 'medium']
 *   4. canSpend() gate per call
 *   5. KronosClient.forecast()
 *   6. Upsert into kronos_forecasts
 *   7. logUsage (fire-and-forget)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { FeatureFlagService, usdToCents } from '@/lib/feature-flags/FeatureFlagService'
import { kronosClient } from '@/lib/kronos/KronosClient'
import { STRATEGY_REGISTRY_CONFIG, type StrategyKey } from '@/lib/strategies/strategy-registry'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Estimated cost per Kronos forecast call in cents. */
const KRONOS_ESTIMATE_CENTS = 10   // ~$0.10 per call (Hetzner GPU compute)

/** Default horizon used for nightly sync. */
const DEFAULT_HORIZON_HOURS = 24 as const

/** Default interval for nightly sync. */
const DEFAULT_INTERVAL = '1d' as const

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncKronosResult {
  usersProcessed: number
  symbolsForecasted: number
  symbolsSkipped: number
  errors: string[]
}

interface WatchlistEntry {
  symbol: string
  strategyKey: StrategyKey
  interval?: '1h' | '4h' | '1d'
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export async function runSyncKronos(
  supabase: SupabaseClient
): Promise<SyncKronosResult> {
  const result: SyncKronosResult = {
    usersProcessed: 0,
    symbolsForecasted: 0,
    symbolsSkipped: 0,
    errors: [],
  }

  // ── Step 1: find all users with kronos flag enabled ───────────────────────
  const { data: flagRows, error: flagErr } = await supabase
    .from('ai_feature_flags')
    .select('user_id')
    .eq('feature_key', 'kronos')
    .eq('enabled', true)

  if (flagErr) {
    result.errors.push(`Failed to fetch flag rows: ${flagErr.message}`)
    return result
  }

  const userIds = (flagRows ?? []).map(r => r.user_id as string)
  if (!userIds.length) return result

  // ── Step 2: process each user ─────────────────────────────────────────────
  for (const userId of userIds) {
    try {
      const entries = await buildWatchlist(supabase, userId)
      const svc = new FeatureFlagService(supabase)

      for (const entry of entries) {
        const cfg = STRATEGY_REGISTRY_CONFIG[entry.strategyKey]
        if (cfg.kronos === 'skip') {
          result.symbolsSkipped++
          continue
        }

        // Feature-flag gate
        const gate = await svc.canSpend(userId, 'kronos', KRONOS_ESTIMATE_CENTS)
        if (!gate.allowed) {
          result.symbolsSkipped++
          continue
        }

        // Run forecast
        try {
          const interval = entry.interval ?? DEFAULT_INTERVAL
          const forecast = await kronosClient.forecast({
            symbol: entry.symbol,
            interval,
            horizonHours: DEFAULT_HORIZON_HOURS,
          })

          const expiresAt = new Date(
            Date.now() + DEFAULT_HORIZON_HOURS * 60 * 60 * 1000
          ).toISOString()

          // Upsert into kronos_forecasts
          await supabase.from('kronos_forecasts').upsert(
            {
              user_id: userId,
              symbol: entry.symbol,
              strategy_key: entry.strategyKey,
              interval,
              horizon_hours: DEFAULT_HORIZON_HOURS,
              skew: forecast.skew,
              skew_strength: forecast.skewStrength,
              p10: forecast.impliedMove.p10,
              p50: forecast.impliedMove.p50,
              p90: forecast.impliedMove.p90,
              confidence_score: forecast.confidenceScore,
              distribution: forecast.distribution,
              generated_at: forecast.generatedAt,
              expires_at: expiresAt,
            },
            { onConflict: 'user_id,symbol,strategy_key,generated_at' }
          )

          // Log usage (fire-and-forget)
          svc.logUsage({
            userId,
            featureKey: 'kronos',
            operation: `sync_kronos:${entry.strategyKey}:${entry.symbol}`,
            costCents: KRONOS_ESTIMATE_CENTS,
            metadata: {
              symbol: entry.symbol,
              strategyKey: entry.strategyKey,
              skew: forecast.skew,
              skewStrength: forecast.skewStrength,
            },
          }).catch(() => {})

          result.symbolsForecasted++
        } catch (forecastErr) {
          result.errors.push(
            `[${userId}] ${entry.symbol}/${entry.strategyKey}: ${forecastErr instanceof Error ? forecastErr.message : String(forecastErr)}`
          )
          result.symbolsSkipped++
        }
      }

      result.usersProcessed++
    } catch (userErr) {
      result.errors.push(
        `[${userId}]: ${userErr instanceof Error ? userErr.message : String(userErr)}`
      )
    }
  }

  // ── Step 3: prune expired forecasts ──────────────────────────────────────
  await supabase
    .from('kronos_forecasts')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .then(({ error }) => {
      if (error) console.warn('[sync-kronos] prune error:', error.message)
    })

  return result
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build the list of (symbol, strategyKey) pairs to forecast for a user.
 * Sources:
 *   1. Open positions (symbol + strategy_key from user_copied_positions)
 *   2. User watchlist (if table exists)
 * Deduplicates (symbol, strategyKey) pairs.
 */
async function buildWatchlist(
  supabase: SupabaseClient,
  userId: string
): Promise<WatchlistEntry[]> {
  const seen = new Set<string>()
  const entries: WatchlistEntry[] = []

  function add(symbol: string, strategyKey: StrategyKey, interval?: '1h' | '4h' | '1d') {
    const key = `${symbol}::${strategyKey}`
    if (!seen.has(key)) {
      seen.add(key)
      entries.push({ symbol, strategyKey, interval })
    }
  }

  // From open positions
  const { data: positions } = await supabase
    .from('user_copied_positions')
    .select('symbol, asset_class')
    .eq('user_id', userId)
    .eq('status', 'open')

  for (const pos of positions ?? []) {
    const strategyKey = defaultStrategyKey(pos.asset_class)
    add(pos.symbol, strategyKey)
  }

  // From watchlist (table may not exist)
  try {
    const { data: watchlist } = await supabase
      .from('user_watchlist')
      .select('symbol, strategy_key, interval')
      .eq('user_id', userId)

    for (const w of watchlist ?? []) {
      const sk = (w.strategy_key && w.strategy_key in STRATEGY_REGISTRY_CONFIG)
        ? (w.strategy_key as StrategyKey)
        : defaultStrategyKey(w.symbol)
      add(w.symbol, sk, w.interval ?? undefined)
    }
  } catch {
    // watchlist table may not exist yet
  }

  return entries
}

/**
 * Infer a default strategy key from asset class for positions without one.
 * Used when a position was created without explicit strategy metadata.
 */
function defaultStrategyKey(assetClassOrSymbol: string): StrategyKey {
  const lc = assetClassOrSymbol.toLowerCase()
  if (lc === 'crypto' || lc.includes('btc') || lc.includes('eth')) return 'onchain_signal'
  if (lc === 'forex' || lc.includes('usd') || lc.includes('eur')) return 'fx_trendfollowing'
  return 'vcp_minervini'  // stock default — Kronos is HIGH for this
}

// ─── Cost helper re-export for callers ───────────────────────────────────────
export { usdToCents, KRONOS_ESTIMATE_CENTS }
