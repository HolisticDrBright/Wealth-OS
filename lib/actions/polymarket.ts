'use server'

import { closePaperPosition, setStrategyFlag } from '@/lib/meta-poly/client'
import { writeFile } from '@/lib/vault/client'
import { renderOutcomeNote, renderPolyTradeNote, renderPolyOutcomeNote } from '@/lib/vault/templates'
import type { SignalStrategy } from '@/lib/meta-poly/types'
import type { TradeEvent, PositionClosedEvent, PositionSettledEvent } from '@/lib/meta-poly/ws'

export async function closePositionAction(
  marketId: string
): Promise<{ pnl?: number; error?: string }> {
  const res = await closePaperPosition(marketId)
  if (!res.ok) return { error: res.error.message }

  // Write outcome note — best-effort, never fails the close
  try {
    const today = new Date().toISOString().slice(0, 10)
    const { path, content } = renderOutcomeNote({
      symbol: `poly-${res.value.market_id.slice(0, 8)}`,
      originalDecision: 'execute',
      entryDate: today,
      exitDate: today,
      pnlPct: res.value.pnl,
      hitTarget: res.value.pnl > 0,
      notes: `Polymarket position closed manually.\nMarket ID: \`${res.value.market_id}\`\nAbsolute P&L: ${res.value.pnl >= 0 ? '+' : ''}$${res.value.pnl.toFixed(2)}`,
    })
    await writeFile(
      path,
      content,
      `feat: poly position closed manually ${res.value.market_id.slice(0, 8)}`,
      'closePositionAction',
    )
  } catch (err) {
    console.warn('[closePositionAction] vault write skipped:', err instanceof Error ? err.message : err)
  }

  return { pnl: res.value.pnl }
}

export async function toggleStrategyAction(
  name: SignalStrategy,
  enabled: boolean
): Promise<{ ok?: boolean; error?: string }> {
  const res = await setStrategyFlag(name, enabled)
  if (!res.ok) return { error: res.error.message }
  return { ok: true }
}

export async function recordPolyTradeAction(event: TradeEvent): Promise<void> {
  try {
    const { path, content } = renderPolyTradeNote(event)
    await writeFile(
      path,
      content,
      `feat: poly trade opened ${event.side} ${event.market_id.slice(0, 8)} [${event.strategy}]`,
      'PolymarketWS',
    )
  } catch {
    // Best-effort — never surface vault errors to the UI
  }
}

export async function recordPolyOutcomeAction(
  event: PositionClosedEvent | PositionSettledEvent,
): Promise<void> {
  try {
    const { path, content } = renderPolyOutcomeNote(event)
    const pnl = event.pnl >= 0 ? `+$${event.pnl.toFixed(2)}` : `-$${Math.abs(event.pnl).toFixed(2)}`
    await writeFile(
      path,
      content,
      `feat: poly position closed ${event.market_id.slice(0, 8)} ${pnl}`,
      'PolymarketWS',
    )
  } catch {
    // Best-effort — never surface vault errors to the UI
  }
}
