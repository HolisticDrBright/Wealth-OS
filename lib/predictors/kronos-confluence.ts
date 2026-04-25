/**
 * Kronos confluence gate — v2.
 *
 * Reads pre-computed forecasts from the kronos_forecasts table (written by the
 * nightly sync-kronos worker) rather than calling the Kronos API inline.
 * This keeps trade-entry latency low and ensures budget is only consumed during
 * the nightly batch, not per-trade.
 *
 * Decision logic:
 *   - 'skip' strategy  → always pass (Kronos not applicable)
 *   - flag OFF         → always pass (user opted out)
 *   - 'high'           → block if opposing skew with |skewStrength| > 0.3
 *   - 'medium'         → warn only (note in reason, don't block)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { FeatureFlagService } from '@/lib/feature-flags/FeatureFlagService'
import { STRATEGY_REGISTRY_CONFIG, type StrategyKey } from '@/lib/strategies/strategy-registry'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KronosForecastRow {
  id: string
  user_id: string
  symbol: string
  strategy_key: string
  skew: 'bullish' | 'neutral' | 'bearish'
  skew_strength: number
  p10: number
  p50: number
  p90: number
  confidence_score: number
  generated_at: string
  expires_at: string
}

export interface KronosConfluenceResult {
  pass: boolean
  skew: 'bullish' | 'neutral' | 'bearish'
  reason: string
  forecast?: KronosForecastRow
}

// Block threshold: only block on clearly directional opposing signal
const BLOCK_STRENGTH_THRESHOLD = 0.3

// ─── Main helper ──────────────────────────────────────────────────────────────

/**
 * Check whether the latest Kronos forecast approves a trade entry.
 *
 * @param supabase        Supabase client (user-scoped or admin)
 * @param userId          ID of the user taking the trade
 * @param symbol          Ticker, e.g. 'AAPL', 'BTCUSDT'
 * @param strategyKey     Which strategy is executing
 * @param desiredDirection  'long' if buying / 'short' if selling
 */
export async function getKronosConfluence(
  supabase: SupabaseClient,
  userId: string,
  symbol: string,
  strategyKey: StrategyKey,
  desiredDirection: 'long' | 'short'
): Promise<KronosConfluenceResult> {
  const cfg = STRATEGY_REGISTRY_CONFIG[strategyKey]

  // ── Gate 1: strategy eligibility ─────────────────────────────────────────
  if (cfg.kronos === 'skip') {
    return {
      pass: true,
      skew: 'neutral',
      reason: 'kronos not applicable for this strategy',
    }
  }

  // ── Gate 2: user feature flag ─────────────────────────────────────────────
  const svc = new FeatureFlagService(supabase)
  const enabled = await svc.isEnabled(userId, 'kronos')
  if (!enabled) {
    return {
      pass: true,
      skew: 'neutral',
      reason: 'kronos disabled by user (no filter applied)',
    }
  }

  // ── Gate 3: look up latest non-expired forecast ───────────────────────────
  const { data: forecast } = await supabase
    .from('kronos_forecasts')
    .select('*')
    .eq('user_id', userId)
    .eq('symbol', symbol)
    .eq('strategy_key', strategyKey)
    .gt('expires_at', new Date().toISOString())
    .order('generated_at', { ascending: false })
    .limit(1)
    .single()

  if (!forecast) {
    // No current forecast — fail open (sync worker may not have run yet)
    return {
      pass: true,
      skew: 'neutral',
      reason: 'no current kronos forecast available (fail-open)',
    }
  }

  const row = forecast as KronosForecastRow
  const skew = row.skew
  const strength = Math.abs(row.skew_strength ?? 0)

  // Determine if Kronos opposes the intended direction
  const kronosOpposes =
    (desiredDirection === 'long' && skew === 'bearish') ||
    (desiredDirection === 'short' && skew === 'bullish')

  if (!kronosOpposes) {
    return {
      pass: true,
      skew,
      reason: `kronos agrees: ${skew} for ${symbol} (strength ${row.skew_strength?.toFixed(2)})`,
      forecast: row,
    }
  }

  // ── Gate 4: high-tier → block if strength exceeds threshold ──────────────
  if (cfg.kronos === 'high' && strength > BLOCK_STRENGTH_THRESHOLD) {
    return {
      pass: false,
      skew,
      reason: `kronos opposes ${desiredDirection}: ${skew} skew for ${symbol} (strength ${row.skew_strength?.toFixed(2)}, confidence ${row.confidence_score})`,
      forecast: row,
    }
  }

  // medium-tier → warn only, don't block
  return {
    pass: true,
    skew,
    reason: `kronos warns: ${skew} for ${symbol} (medium-tier — not blocking)`,
    forecast: row,
  }
}
