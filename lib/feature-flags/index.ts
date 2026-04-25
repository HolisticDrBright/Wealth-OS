/**
 * FeatureFlagService — per-user AI feature toggles with monthly budget caps.
 *
 * Design:
 *   - All features default OFF; users opt in.
 *   - canSpend() checks: enabled + under monthly budget. Never throws — returns false on DB error.
 *   - logUsage() is fire-and-forget; failures are logged but never surface to callers.
 *   - checkBudgetAlert() sends a Telegram notification when spend crosses the alert threshold.
 *   - withFeatureFlag() wraps any async fn with gate check + usage log.
 */

import { createClient } from '@/lib/supabase/server'

export interface FeatureFlag {
  feature_key: string
  enabled: boolean
  monthly_budget_usd: number
  alert_threshold_pct: number
}

export interface UsageLog {
  user_id: string
  feature_key: string
  cost_usd: number
  tokens_used?: number
  strategy?: string
  symbol?: string
  metadata?: Record<string, unknown>
}

export interface SpendStatus {
  spend_usd: number
  budget_usd: number
  remaining_usd: number
  pct_used: number
}

export class FeatureFlagService {
  constructor(private readonly userId: string) {}

  /** Returns the flag row for a feature, or null if not set (treat as disabled). */
  async getFlag(featureKey: string): Promise<FeatureFlag | null> {
    try {
      const supabase = await createClient()
      const { data } = await supabase
        .from('ai_feature_flags')
        .select('feature_key, enabled, monthly_budget_usd, alert_threshold_pct')
        .eq('user_id', this.userId)
        .eq('feature_key', featureKey)
        .single()
      return data ?? null
    } catch {
      return null
    }
  }

  /** Returns true only if: flag exists, enabled=true, and spend < budget. */
  async canSpend(featureKey: string, estimatedCostUsd = 0): Promise<boolean> {
    try {
      const flag = await this.getFlag(featureKey)
      if (!flag?.enabled) return false

      const supabase = await createClient()
      const { data } = await supabase.rpc('get_monthly_spend', {
        p_user_id: this.userId,
        p_feature_key: featureKey,
      })
      const spent = (data as number | null) ?? 0
      return spent + estimatedCostUsd <= flag.monthly_budget_usd
    } catch {
      return false
    }
  }

  /** Fire-and-forget usage log. Also triggers budget alert if threshold crossed. */
  async logUsage(entry: Omit<UsageLog, 'user_id'>): Promise<void> {
    try {
      const supabase = await createClient()
      await supabase.from('ai_usage_logs').insert({
        user_id: this.userId,
        feature_key: entry.feature_key,
        cost_usd: entry.cost_usd,
        tokens_used: entry.tokens_used ?? null,
        strategy: entry.strategy ?? null,
        symbol: entry.symbol ?? null,
        metadata: entry.metadata ?? null,
      })
      await this.checkBudgetAlert(entry.feature_key)
    } catch (err) {
      console.warn('[FeatureFlags] logUsage failed (non-fatal):', err)
    }
  }

  /** Sends Telegram alert if this month's spend has crossed the alert threshold. */
  async checkBudgetAlert(featureKey: string): Promise<void> {
    try {
      const flag = await this.getFlag(featureKey)
      if (!flag?.enabled) return

      const supabase = await createClient()
      const { data } = await supabase.rpc('get_monthly_spend', {
        p_user_id: this.userId,
        p_feature_key: featureKey,
      })
      const spent = (data as number | null) ?? 0
      const pct = (spent / flag.monthly_budget_usd) * 100

      if (pct >= flag.alert_threshold_pct) {
        await sendTelegramAlert(
          `⚠️ *Wealth OS — AI Budget Alert*\n\nFeature: \`${featureKey}\`\nSpent: $${spent.toFixed(2)} / $${flag.monthly_budget_usd.toFixed(2)} (${pct.toFixed(0)}%)\n\nYou are at or above your ${flag.alert_threshold_pct}% alert threshold.`
        )
      }
    } catch {
      // Non-fatal — budget alerts are best-effort
    }
  }

  /** Get current month spend status for a feature. */
  async getSpendStatus(featureKey: string): Promise<SpendStatus | null> {
    try {
      const flag = await this.getFlag(featureKey)
      if (!flag) return null

      const supabase = await createClient()
      const { data } = await supabase.rpc('get_monthly_spend', {
        p_user_id: this.userId,
        p_feature_key: featureKey,
      })
      const spent = (data as number | null) ?? 0
      return {
        spend_usd: spent,
        budget_usd: flag.monthly_budget_usd,
        remaining_usd: Math.max(0, flag.monthly_budget_usd - spent),
        pct_used: flag.monthly_budget_usd > 0 ? (spent / flag.monthly_budget_usd) * 100 : 0,
      }
    } catch {
      return null
    }
  }

  /** Get all flags for this user (for Settings UI). */
  async getAllFlags(): Promise<FeatureFlag[]> {
    try {
      const supabase = await createClient()
      const { data } = await supabase
        .from('ai_feature_flags')
        .select('feature_key, enabled, monthly_budget_usd, alert_threshold_pct')
        .eq('user_id', this.userId)
      return data ?? []
    } catch {
      return []
    }
  }

  /** Upsert a flag (enable/disable or change budget). */
  async setFlag(
    featureKey: string,
    updates: Partial<Pick<FeatureFlag, 'enabled' | 'monthly_budget_usd' | 'alert_threshold_pct'>>
  ): Promise<void> {
    const supabase = await createClient()
    await supabase.from('ai_feature_flags').upsert(
      {
        user_id: this.userId,
        feature_key: featureKey,
        enabled: updates.enabled ?? false,
        monthly_budget_usd: updates.monthly_budget_usd ?? 20,
        alert_threshold_pct: updates.alert_threshold_pct ?? 80,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,feature_key' }
    )
  }
}

// ─── withFeatureFlag wrapper ──────────────────────────────────────────────────

/**
 * Gate an async operation behind a feature flag check.
 * If the flag is off or budget exhausted, returns fallback immediately.
 * If the operation succeeds, logs usage.
 *
 * @param userId      Authenticated user
 * @param featureKey  e.g. 'mirofish'
 * @param costUsd     Estimated cost for this call
 * @param fn          The operation to gate
 * @param fallback    Value returned when gated out
 */
export async function withFeatureFlag<T>(
  userId: string,
  featureKey: string,
  costUsd: number,
  fn: () => Promise<T>,
  fallback: T,
  logMeta?: Omit<UsageLog, 'user_id' | 'feature_key' | 'cost_usd'>
): Promise<T> {
  const svc = new FeatureFlagService(userId)
  const allowed = await svc.canSpend(featureKey, costUsd)
  if (!allowed) return fallback

  try {
    const result = await fn()
    // Log after success — don't await to keep hot path fast
    svc.logUsage({ feature_key: featureKey, cost_usd: costUsd, ...logMeta }).catch(() => {})
    return result
  } catch (err) {
    console.warn(`[withFeatureFlag] ${featureKey} failed (non-fatal):`, err)
    return fallback
  }
}

// ─── Telegram notification ────────────────────────────────────────────────────

async function sendTelegramAlert(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(5_000),
    })
  } catch {
    // Never fail on Telegram — it's a notification, not core functionality
  }
}
