/**
 * Telegram notification helper.
 *
 * Requires two env vars:
 *   TELEGRAM_BOT_TOKEN — token from @BotFather
 *   (chat_id is per-user, fetched from user_settings.telegram_chat_id)
 *
 * All functions are best-effort: they never throw, and silently no-op when
 * the bot token is not configured.
 */

const TELEGRAM_API = 'https://api.telegram.org'

/**
 * Send a Markdown message to a specific chat ID.
 * Returns true on success, false on any failure.
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  parseMode: 'Markdown' | 'HTML' = 'Markdown'
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return false
  if (!chatId) return false

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
      signal: AbortSignal.timeout(5_000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Convenience: send a budget alert. */
export async function sendBudgetAlert(params: {
  chatId: string
  featureKey: string
  spentCents: number
  budgetCents: number
  thresholdPct: number
}): Promise<void> {
  const pct = ((params.spentCents / params.budgetCents) * 100).toFixed(0)
  const spent = (params.spentCents / 100).toFixed(2)
  const budget = (params.budgetCents / 100).toFixed(2)

  await sendTelegramMessage(
    params.chatId,
    `⚠️ *Wealth OS — AI Budget Alert*\n\n` +
      `Feature: \`${params.featureKey}\`\n` +
      `Spent: $${spent} / $${budget} (${pct}%)\n\n` +
      `You've crossed your ${params.thresholdPct}% alert threshold.`
  )
}
