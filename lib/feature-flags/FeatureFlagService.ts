/**
 * FeatureFlagService
 *
 * Single source of truth for all paid-API gating. Every call that costs money
 * passes through canSpend() before executing and logUsage() after.
 *
 * Units: all public methods use CENTS (integer). The DB stores USD; conversion
 * happens at the boundary (centsToUsd / usdToCents). This avoids floating-point
 * drift accumulating across thousands of logged calls.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendTelegramMessage } from '@/lib/notifications/telegram'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CanSpendResult =
  | { allowed: true; remainingBudgetCents: number | null }
  | {
      allowed: false
      reason: 'disabled' | 'over_budget' | 'feature_not_found'
      remainingBudgetCents?: number
    }

export interface LogUsageParams {
  userId: string
  featureKey: string
  operation: string
  costCents: number
  tokensIn?: number
  tokensOut?: number
  latencyMs?: number
  tradeId?: string
  simulationId?: string
  metadata?: Record<string, unknown>
}

interface FlagRow {
  enabled: boolean
  monthly_budget_usd: number | null
  alert_threshold_pct: number
}

// ─── Conversions ──────────────────────────────────────────────────────────────

export function usdToCents(usd: number): number {
  return Math.round(usd * 100)
}

export function centsToUsd(cents: number): number {
  return cents / 100
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class FeatureFlagService {
  constructor(private readonly supabase: SupabaseClient) {}

  /** True only if the flag row exists AND enabled = true. */
  async isEnabled(userId: string, featureKey: string): Promise<boolean> {
    const row = await this._getFlag(userId, featureKey)
    return row?.enabled ?? false
  }

  /**
   * Sum of all cost_usd logs this calendar month, converted to cents.
   * Returns 0 on any DB error (fail-open so callers aren't blocked by infra).
   */
  async getMonthlyUsage(userId: string, featureKey: string): Promise<number> {
    try {
      const { data, error } = await this.supabase.rpc('get_monthly_spend', {
        p_user_id: userId,
        p_feature_key: featureKey,
      })
      if (error) return 0
      return usdToCents((data as number | null) ?? 0)
    } catch {
      return 0
    }
  }

  /**
   * Monthly budget in cents, or null when unlimited (no flag row or budget null).
   * A budget of $0 returns 0 cents (fully blocked), not null.
   */
  async getMonthlyBudget(userId: string, featureKey: string): Promise<number | null> {
    const row = await this._getFlag(userId, featureKey)
    if (!row || row.monthly_budget_usd === null || row.monthly_budget_usd === undefined) return null
    return usdToCents(row.monthly_budget_usd)
  }

  /**
   * Gate check: returns allowed + remaining budget, or a typed failure reason.
   * Never throws — DB errors produce feature_not_found.
   */
  async canSpend(
    userId: string,
    featureKey: string,
    costCents: number
  ): Promise<CanSpendResult> {
    let row: FlagRow | null
    try {
      row = await this._getFlag(userId, featureKey)
    } catch {
      return { allowed: false, reason: 'feature_not_found' }
    }

    if (!row) return { allowed: false, reason: 'feature_not_found' }
    if (!row.enabled) return { allowed: false, reason: 'disabled' }

    const budgetCents = row.monthly_budget_usd !== null && row.monthly_budget_usd !== undefined
      ? usdToCents(row.monthly_budget_usd) : null
    if (budgetCents === null) {
      // Unlimited
      return { allowed: true, remainingBudgetCents: null }
    }

    const usageCents = await this.getMonthlyUsage(userId, featureKey)
    const remaining = budgetCents - usageCents

    if (usageCents + costCents > budgetCents) {
      return { allowed: false, reason: 'over_budget', remainingBudgetCents: Math.max(0, remaining) }
    }

    return { allowed: true, remainingBudgetCents: remaining - costCents }
  }

  /**
   * Persist a usage record. Fire-and-forget safe — never throws to caller.
   * Converts costCents → cost_usd for the DB column.
   */
  async logUsage(params: LogUsageParams): Promise<void> {
    try {
      const { error } = await this.supabase.from('ai_usage_logs').insert({
        user_id: params.userId,
        feature_key: params.featureKey,
        cost_usd: centsToUsd(params.costCents),
        tokens_used: params.tokensIn,         // legacy column kept for compat
        operation: params.operation,
        tokens_in: params.tokensIn ?? null,
        tokens_out: params.tokensOut ?? null,
        latency_ms: params.latencyMs ?? null,
        trade_id: params.tradeId ?? null,
        simulation_id: params.simulationId ?? null,
        metadata: params.metadata ?? null,
      })
      if (error) console.warn('[FeatureFlags] logUsage DB error:', error.message)
    } catch (err) {
      console.warn('[FeatureFlags] logUsage failed:', err)
    }
  }

  /**
   * Sends a Telegram alert if this month's spend has crossed the user's
   * alert_threshold_pct. Idempotent — will re-alert on every call past the
   * threshold. Callers should call this once per successful API response.
   */
  async checkBudgetAlert(userId: string, featureKey: string): Promise<void> {
    try {
      const [row, usageCents] = await Promise.all([
        this._getFlag(userId, featureKey),
        this.getMonthlyUsage(userId, featureKey),
      ])
      if (!row || row.monthly_budget_usd === null || row.monthly_budget_usd === undefined) return

      const budgetCents = usdToCents(row.monthly_budget_usd)
      if (budgetCents <= 0) return
      const pctUsed = (usageCents / budgetCents) * 100

      if (pctUsed < row.alert_threshold_pct) return

      const chatId = await this._getTelegramChatId(userId)
      if (!chatId) return

      const spent = (usageCents / 100).toFixed(2)
      const budget = (budgetCents / 100).toFixed(2)

      await sendTelegramMessage(
        chatId,
        `⚠️ *Wealth OS — AI Budget Alert*\n\n` +
          `Feature: \`${featureKey}\`\n` +
          `Spent: $${spent} / $${budget} (${pctUsed.toFixed(0)}%)\n\n` +
          `You have reached your ${row.alert_threshold_pct}% alert threshold.`
      )
    } catch {
      // Non-fatal — budget alerts must never surface to the caller
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _getFlag(userId: string, featureKey: string): Promise<FlagRow | null> {
    const { data } = await this.supabase
      .from('ai_feature_flags')
      .select('enabled, monthly_budget_usd, alert_threshold_pct')
      .eq('user_id', userId)
      .eq('feature_key', featureKey)
      .single()
    return data ?? null
  }

  private async _getTelegramChatId(userId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('user_settings')
      .select('telegram_chat_id')
      .eq('id', userId)
      .single()
    return (data as { telegram_chat_id?: string } | null)?.telegram_chat_id ?? null
  }
}
