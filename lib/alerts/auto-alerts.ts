/**
 * Auto-alerts — the alerts table existed but nothing wrote to it. These
 * helpers emit alerts from the paper trading engine. All fire-and-forget:
 * an alert failure must never break a trading pass.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

type AlertSeverity = 'info' | 'warning' | 'critical'
type AlertType = 'trade_executed' | 'risk_breach' | 'price_alert' | 'simulation_done' | 'opportunity' | 'system'

function insertAlert(
  supabase: SupabaseClient,
  userId: string,
  alert: {
    type: AlertType
    title: string
    body?: string
    severity?: AlertSeverity
    action_url?: string
    metadata?: Record<string, unknown>
  },
): void {
  void supabase
    .from('alerts')
    .insert({
      user_id: userId,
      severity: 'info',
      is_read: false,
      metadata: {},
      ...alert,
    })
    .then(({ error }) => {
      if (error) console.warn('[auto-alerts] insert failed:', error.message)
    })
}

/** A paper position was closed (stop, target, or timeout). */
export function alertPositionClosed(
  supabase: SupabaseClient,
  userId: string,
  pos: {
    strategyKey: string
    symbol: string
    exitReason: string
    realizedPnlUsd: number
    realizedPnlPct: number
  },
): void {
  const pnlStr = `${pos.realizedPnlUsd >= 0 ? '+' : '−'}$${Math.abs(pos.realizedPnlUsd).toFixed(2)} (${(pos.realizedPnlPct * 100).toFixed(1)}%)`
  insertAlert(supabase, userId, {
    type: 'trade_executed',
    severity: pos.exitReason === 'stop_loss' ? 'warning' : 'info',
    title: `Paper position closed: ${pos.symbol} ${pnlStr}`,
    body: `${pos.strategyKey} exited via ${pos.exitReason.replace('_', ' ')}.`,
    action_url: '/dashboard',
    metadata: { strategyKey: pos.strategyKey, symbol: pos.symbol, exitReason: pos.exitReason },
  })
}

/** The cross-asset regime changed since the previous paper run. */
export function alertRegimeChange(
  supabase: SupabaseClient,
  userId: string,
  fromRegime: string,
  toRegime: string,
): void {
  const escalating = toRegime === 'CRISIS' || toRegime === 'RISK_OFF'
  insertAlert(supabase, userId, {
    type: 'system',
    severity: toRegime === 'CRISIS' ? 'critical' : escalating ? 'warning' : 'info',
    title: `Market regime changed: ${fromRegime.replace('_', ' ')} → ${toRegime.replace('_', ' ')}`,
    body: toRegime === 'CRISIS'
      ? 'All books closed except tail hedging. Directional strategies are blocked.'
      : escalating
        ? 'Carry book halved; event book trimmed. Trend and convexity keep full size.'
        : 'Book rotation returned to normal sizing.',
    action_url: '/strategies',
    metadata: { fromRegime, toRegime },
  })
}

/** Multiple strategy errors in one run — likely a degraded data feed. */
export function alertRunErrors(
  supabase: SupabaseClient,
  userId: string,
  errors: string[],
): void {
  if (errors.length < 3) return
  insertAlert(supabase, userId, {
    type: 'system',
    severity: 'warning',
    title: `Paper run hit ${errors.length} strategy errors`,
    body: `First error: ${errors[0].slice(0, 180)}`,
    action_url: '/dashboard',
    metadata: { errorCount: errors.length },
  })
}
