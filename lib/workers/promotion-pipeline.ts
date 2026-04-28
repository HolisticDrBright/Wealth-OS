/**
 * Promotion pipeline -- evaluates BRKME promotion gates for all strategies
 * that have accumulated >= 100 paper trades.
 *
 * Called by the cron job (task=promote) or manually via POST /api/cron?task=promote.
 * Strategies failing any gate trigger a Telegram alert and are NOT promoted.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  evaluatePromotionGates,
  type BacktestRow,
  type PromotionGateResult,
} from '@/lib/backtest/promotion-gates'
import { sendTelegramMessage } from '@/lib/notifications/telegram'
import type { StrategyKey } from '@/lib/strategies/strategy-registry'
import { STRATEGY_REGISTRY_CONFIG } from '@/lib/strategies/strategy-registry'

export interface PromotionSummary {
  strategy: StrategyKey
  assetClass: string
  result: PromotionGateResult
  promotedToLive: boolean
}

/**
 * Run promotion gates for every strategy that has >= 100 completed paper trades.
 * Returns a summary per strategy. Sends Telegram alerts for failures.
 */
export async function runPromotionPipeline(
  supabase: SupabaseClient,
  userId: string
): Promise<PromotionSummary[]> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const { data: trades } = await supabase
    .from('paper_trades')
    .select('strategy_key, pnl_pct, opened_at, closed_at')
    .eq('user_id', userId)
    .not('pnl_pct', 'is', null)
    .gte('opened_at', since)

  if (!trades || trades.length === 0) return []

  // Group trades by strategy
  const byStrategy = new Map<string, { returnPct: number; costPct: number }[]>()
  for (const t of trades) {
    const key = t.strategy_key as string
    if (!byStrategy.has(key)) byStrategy.set(key, [])
    byStrategy.get(key)!.push({
      returnPct: (t.pnl_pct as number) / 100,
      costPct: 0.001,  // 10 bps round-trip estimate
    })
  }

  const summaries: PromotionSummary[] = []
  const chatId = await getTelegramChatId(supabase, userId)

  for (const [strategyKey, rows] of byStrategy) {
    const cfg = STRATEGY_REGISTRY_CONFIG[strategyKey as StrategyKey]
    if (!cfg) continue

    // Build rows with baseline placeholder (0 = conservative, no baseline credit)
    const backtestRows: BacktestRow[] = rows.map(r => ({
      ...r,
      baselineReturnPct: 0,
    }))

    const result = evaluatePromotionGates(backtestRows, cfg.assetClass)
    const promotedToLive = result.passed

    if (!result.passed && chatId) {
      const failList = result.failedGates.map(g => `  - ${g}`).join('\n')
      await sendTelegramMessage(
        chatId,
        `*Wealth OS -- Promotion Gate FAILED*\n\n` +
        `Strategy: \`${strategyKey}\`\n` +
        `Failed gates:\n${failList}\n\n` +
        `Trades evaluated: ${result.metrics.tradeCount}\n` +
        `t-stat: ${result.metrics.tStat.toFixed(2)}\n` +
        `Sharpe: ${result.metrics.sharpe.toFixed(2)}\n` +
        `Max DD: ${(result.metrics.maxDrawdownPct * 100).toFixed(1)}%`
      ).catch(() => {/* non-fatal */})
    }

    summaries.push({
      strategy: strategyKey as StrategyKey,
      assetClass: cfg.assetClass,
      result,
      promotedToLive,
    })
  }

  return summaries
}

async function getTelegramChatId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('user_settings')
      .select('telegram_chat_id')
      .eq('id', userId)
      .single()
    return (data as { telegram_chat_id?: string } | null)?.telegram_chat_id ?? null
  } catch {
    return null
  }
}
