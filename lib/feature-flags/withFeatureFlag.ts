/**
 * withFeatureFlag — higher-order wrapper for any paid API call.
 *
 * Usage:
 *   const { result, skipped } = await withFeatureFlag(
 *     supabase, userId, 'mirofish', 120, 'simulate_trade',
 *     async () => {
 *       const out = await callMiroFish(params)
 *       return { result: out, actualCostCents: 120, tokensIn: 800, tokensOut: 200 }
 *     }
 *   )
 *   if (skipped) return fallbackResult
 *
 * Guarantees:
 *   - canSpend() checked before fn() runs — fn() never called when gated.
 *   - Actual cost (not estimated) is logged.
 *   - On exception inside fn(), a minimal failure cost is logged.
 *   - checkBudgetAlert() is fire-and-forget after a successful call.
 *   - This function itself never throws.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { FeatureFlagService } from './FeatureFlagService'

export interface WithFeatureFlagResult<T> {
  result: T | null
  skipped: boolean
  reason?: string
  /** Actual cents logged (0 when skipped) */
  costCents: number
}

export async function withFeatureFlag<T>(
  supabase: SupabaseClient,
  userId: string,
  featureKey: string,
  estimatedCostCents: number,
  operation: string,
  fn: () => Promise<{
    result: T
    actualCostCents: number
    tokensIn?: number
    tokensOut?: number
  }>,
  logMeta?: {
    tradeId?: string
    simulationId?: string
    metadata?: Record<string, unknown>
  }
): Promise<WithFeatureFlagResult<T>> {
  const svc = new FeatureFlagService(supabase)

  // ── Gate check ─────────────────────────────────────────────────────────────
  const gate = await svc.canSpend(userId, featureKey, estimatedCostCents)

  if (!gate.allowed) {
    return { result: null, skipped: true, reason: gate.reason, costCents: 0 }
  }

  // ── Execute ─────────────────────────────────────────────────────────────────
  const startMs = Date.now()
  try {
    const { result, actualCostCents, tokensIn, tokensOut } = await fn()
    const latencyMs = Date.now() - startMs

    // Log actual cost (non-blocking)
    svc
      .logUsage({
        userId,
        featureKey,
        operation,
        costCents: actualCostCents,
        tokensIn,
        tokensOut,
        latencyMs,
        tradeId: logMeta?.tradeId,
        simulationId: logMeta?.simulationId,
        metadata: logMeta?.metadata,
      })
      .catch(() => {})

    // Budget alert (non-blocking)
    svc.checkBudgetAlert(userId, featureKey).catch(() => {})

    return { result, skipped: false, costCents: actualCostCents }
  } catch (err) {
    // Log a small failure cost so budget accounting stays honest
    const failureCostCents = Math.min(estimatedCostCents, 1)
    svc
      .logUsage({
        userId,
        featureKey,
        operation: `${operation}:error`,
        costCents: failureCostCents,
        latencyMs: Date.now() - startMs,
        metadata: { error: err instanceof Error ? err.message : String(err) },
      })
      .catch(() => {})

    return {
      result: null,
      skipped: true,
      reason: `exception: ${err instanceof Error ? err.message : String(err)}`,
      costCents: failureCostCents,
    }
  }
}
