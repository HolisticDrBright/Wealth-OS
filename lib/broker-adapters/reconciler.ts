/**
 * OCO reconciliation from order_intents.
 *
 * Coinbase (and any venue without native OCO) gets entry + stop + take-profit
 * as three independent orders. A fill in the polling gap used to orphan the
 * surviving leg. The reconciler closes that gap deterministically:
 *
 *   entry filled            → verify both bracket legs exist (flag gaps)
 *   entry partially filled  → reduce bracket legs to the filled quantity
 *   stop leg filled         → cancel the take-profit sibling by recorded id
 *   take-profit leg filled  → cancel the stop sibling by recorded id
 *   entry cancelled         → cancel both legs
 *
 * planReconciliation() is PURE (intents + statuses in, actions out) so the
 * sibling-cancel logic is unit-testable without brokers or Supabase.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface OrderIntentRow {
  id: string
  user_id: string
  opportunity_id: string
  client_order_id: string
  leg: 'entry' | 'stop' | 'take_profit'
  broker: string | null
  symbol: string | null
  side: string | null
  status: string
  broker_order_id: string | null
  quantity: number | null
  filled_quantity: number | null
  stop_price: number | null
  limit_price: number | null
}

export interface BrokerOrderStatus {
  status: 'open' | 'filled' | 'partially_filled' | 'cancelled' | 'unknown'
  filledQuantity?: number
}

export interface ReconcilerOps {
  getOrderStatus(broker: string, brokerOrderId: string): Promise<BrokerOrderStatus>
  cancelOrder(broker: string, brokerOrderId: string): Promise<boolean>
  /**
   * Reduce a live leg to the entry's filled quantity (cancel + resubmit with
   * a deterministic derived id on venues without modify). Optional: when
   * absent, partial fills are reported, never silently dropped.
   */
  reduceOrderSize?(intent: OrderIntentRow, newQuantity: number): Promise<{ ok: boolean; newBrokerOrderId?: string }>
}

export type ReconcileAction =
  | { type: 'mark'; intent: OrderIntentRow; status: 'filled' | 'partially_filled' | 'cancelled'; filledQuantity?: number }
  | { type: 'cancel_sibling'; intent: OrderIntentRow; reason: string }
  | { type: 'reduce_leg'; intent: OrderIntentRow; newQuantity: number; reason: string }
  | { type: 'flag_missing_leg'; opportunityId: string; leg: 'stop' | 'take_profit'; reason: string }

const LIVE = new Set(['submitted', 'partially_filled', 'pending'])

/**
 * Decide reconciliation actions for ONE opportunity's intents.
 * `statuses` is keyed by broker_order_id.
 */
export function planReconciliation(
  intents: OrderIntentRow[],
  statuses: Map<string, BrokerOrderStatus>
): ReconcileAction[] {
  const actions: ReconcileAction[] = []
  const entry = intents.find(i => i.leg === 'entry')
  const stop = intents.find(i => i.leg === 'stop')
  const tp = intents.find(i => i.leg === 'take_profit')

  const statusOf = (i?: OrderIntentRow): BrokerOrderStatus =>
    (i?.broker_order_id && statuses.get(i.broker_order_id)) || { status: 'unknown' }

  const entryStatus = statusOf(entry)

  // ── Entry outcomes ──────────────────────────────────────────────────────────
  if (entry && LIVE.has(entry.status)) {
    if (entryStatus.status === 'filled') {
      actions.push({ type: 'mark', intent: entry, status: 'filled' })
      // Both bracket legs must exist once the entry is filled.
      for (const [legName, legIntent] of [['stop', stop], ['take_profit', tp]] as const) {
        if (legIntent && !legIntent.broker_order_id && LIVE.has(legIntent.status)) {
          actions.push({
            type: 'flag_missing_leg',
            opportunityId: entry.opportunity_id,
            leg: legName,
            reason: `entry filled but ${legName} leg has no broker order — position unprotected`,
          })
        }
      }
    } else if (entryStatus.status === 'partially_filled') {
      const filled = entryStatus.filledQuantity ?? 0
      actions.push({ type: 'mark', intent: entry, status: 'partially_filled', filledQuantity: filled })
      // Bracket legs must cover only what actually filled.
      for (const legIntent of [stop, tp]) {
        if (
          legIntent?.broker_order_id && LIVE.has(legIntent.status) &&
          legIntent.quantity != null && filled > 0 && legIntent.quantity > filled
        ) {
          actions.push({
            type: 'reduce_leg',
            intent: legIntent,
            newQuantity: filled,
            reason: `entry partially filled (${filled}/${legIntent.quantity}) — resize bracket leg`,
          })
        }
      }
    } else if (entryStatus.status === 'cancelled') {
      actions.push({ type: 'mark', intent: entry, status: 'cancelled' })
      for (const legIntent of [stop, tp]) {
        if (legIntent?.broker_order_id && LIVE.has(legIntent.status)) {
          actions.push({ type: 'cancel_sibling', intent: legIntent, reason: 'entry cancelled — remove orphan legs' })
        }
      }
    }
  }

  // ── OCO: one exit leg filled → cancel the sibling deterministically ────────
  const pairs: Array<[OrderIntentRow | undefined, OrderIntentRow | undefined, string]> = [
    [stop, tp, 'stop filled — cancel take-profit sibling'],
    [tp, stop, 'take-profit filled — cancel stop sibling'],
  ]
  for (const [filledLeg, sibling, reason] of pairs) {
    if (!filledLeg || !LIVE.has(filledLeg.status)) continue
    if (statusOf(filledLeg).status !== 'filled') continue
    actions.push({ type: 'mark', intent: filledLeg, status: 'filled' })
    if (sibling?.broker_order_id && LIVE.has(sibling.status)) {
      actions.push({ type: 'cancel_sibling', intent: sibling, reason })
    }
  }

  return actions
}

// ─── Orchestration ────────────────────────────────────────────────────────────

export interface ReconcileReport {
  scanned: number
  marked: number
  cancelled: number
  reduced: number
  missingLegs: number
  errors: string[]
}

export async function reconcileOrderIntents(
  supabase: SupabaseClient,
  ops: ReconcilerOps
): Promise<ReconcileReport> {
  const report: ReconcileReport = { scanned: 0, marked: 0, cancelled: 0, reduced: 0, missingLegs: 0, errors: [] }

  const { data, error } = await supabase
    .from('order_intents')
    .select('id, user_id, opportunity_id, client_order_id, leg, broker, symbol, side, status, broker_order_id, quantity, filled_quantity, stop_price, limit_price')
    .in('status', ['submitted', 'partially_filled'])
  if (error) {
    report.errors.push(`order_intents read failed: ${error.message}`)
    return report
  }

  const rows = (data ?? []) as OrderIntentRow[]
  report.scanned = rows.length
  if (rows.length === 0) return report

  const byOpp = new Map<string, OrderIntentRow[]>()
  for (const r of rows) {
    const key = `${r.user_id}:${r.opportunity_id}`
    if (!byOpp.has(key)) byOpp.set(key, [])
    byOpp.get(key)!.push(r)
  }

  for (const intents of byOpp.values()) {
    // Fetch broker order statuses for every leg that has an id.
    const statuses = new Map<string, BrokerOrderStatus>()
    for (const i of intents) {
      if (!i.broker_order_id || !i.broker) continue
      try {
        statuses.set(i.broker_order_id, await ops.getOrderStatus(i.broker, i.broker_order_id))
      } catch (err) {
        report.errors.push(`status(${i.broker_order_id}): ${err instanceof Error ? err.message : err}`)
      }
    }

    for (const action of planReconciliation(intents, statuses)) {
      try {
        if (action.type === 'mark') {
          await supabase.from('order_intents').update({
            status: action.status,
            filled_quantity: action.filledQuantity ?? null,
            updated_at: new Date().toISOString(),
          }).eq('id', action.intent.id)
          report.marked++
        } else if (action.type === 'cancel_sibling') {
          const ok = await ops.cancelOrder(action.intent.broker!, action.intent.broker_order_id!)
          await supabase.from('order_intents').update({
            status: ok ? 'cancelled' : action.intent.status,
            error: ok ? action.reason : `cancel failed: ${action.reason}`,
            updated_at: new Date().toISOString(),
          }).eq('id', action.intent.id)
          if (ok) report.cancelled++
          else report.errors.push(`cancel failed for ${action.intent.client_order_id}`)
        } else if (action.type === 'reduce_leg') {
          const res = ops.reduceOrderSize
            ? await ops.reduceOrderSize(action.intent, action.newQuantity)
            : { ok: false }
          if (res.ok) {
            await supabase.from('order_intents').update({
              quantity: action.newQuantity,
              broker_order_id: res.newBrokerOrderId ?? action.intent.broker_order_id,
              error: action.reason,
              updated_at: new Date().toISOString(),
            }).eq('id', action.intent.id)
            report.reduced++
          } else {
            report.errors.push(`reduce unsupported/failed for ${action.intent.client_order_id}: ${action.reason}`)
          }
        } else {
          report.missingLegs++
          console.warn(`[reconciler] MISSING LEG ${action.leg} for opportunity ${action.opportunityId}: ${action.reason}`)
        }
      } catch (err) {
        report.errors.push(`${action.type}: ${err instanceof Error ? err.message : err}`)
      }
    }
  }

  return report
}
