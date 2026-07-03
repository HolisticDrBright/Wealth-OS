/**
 * Default broker operations for the OCO reconciler.
 *
 * Coinbase is the venue that NEEDS reconciliation (no native OCO — legs are
 * independent orders). Alpaca/OANDA brackets are broker-native OCO and manage
 * their own siblings; unknown venues report status 'unknown' and the
 * reconciler leaves them alone rather than guessing.
 */

import { createHmac } from 'crypto'
import type { BrokerOrderStatus, OrderIntentRow, ReconcilerOps } from './reconciler'

async function coinbaseGet(path: string): Promise<Record<string, unknown> | null> {
  const key = process.env.COINBASE_API_KEY
  const secret = process.env.COINBASE_API_SECRET
  if (!key || !secret) return null
  const ts = Math.floor(Date.now() / 1000).toString()
  const sig = createHmac('sha256', secret).update(`${ts}GET${path}`).digest('hex')
  const res = await fetch(`https://api.coinbase.com${path}`, {
    headers: { 'CB-ACCESS-KEY': key, 'CB-ACCESS-SIGN': sig, 'CB-ACCESS-TIMESTAMP': ts },
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) return null
  return await res.json() as Record<string, unknown>
}

async function coinbaseOrderStatus(brokerOrderId: string): Promise<BrokerOrderStatus> {
  const data = await coinbaseGet(`/api/v3/brokerage/historical/orders/${brokerOrderId}`)
  const order = (data?.order ?? null) as Record<string, unknown> | null
  if (!order) return { status: 'unknown' }

  const raw = String(order.status ?? '').toUpperCase()
  const filledSize = parseFloat(String(order.filled_size ?? '0'))
  if (raw === 'FILLED') return { status: 'filled', filledQuantity: filledSize || undefined }
  if (raw === 'CANCELLED' || raw === 'EXPIRED' || raw === 'FAILED') return { status: 'cancelled' }
  if (raw === 'OPEN' || raw === 'QUEUED' || raw === 'PENDING') {
    return filledSize > 0
      ? { status: 'partially_filled', filledQuantity: filledSize }
      : { status: 'open' }
  }
  return { status: 'unknown' }
}

async function coinbaseCancel(brokerOrderId: string): Promise<boolean> {
  const key = process.env.COINBASE_API_KEY
  const secret = process.env.COINBASE_API_SECRET
  if (!key || !secret) return false
  const ts = Math.floor(Date.now() / 1000).toString()
  const path = '/api/v3/brokerage/orders/batch_cancel'
  const body = JSON.stringify({ order_ids: [brokerOrderId] })
  const sig = createHmac('sha256', secret).update(`${ts}POST${path}${body}`).digest('hex')
  const res = await fetch(`https://api.coinbase.com${path}`, {
    method: 'POST',
    headers: {
      'CB-ACCESS-KEY': key, 'CB-ACCESS-SIGN': sig, 'CB-ACCESS-TIMESTAMP': ts,
      'Content-Type': 'application/json',
    },
    body,
    signal: AbortSignal.timeout(8_000),
  })
  return res.ok
}

async function coinbasePost(path: string, body: string): Promise<{ ok: boolean; data: Record<string, unknown> | null }> {
  const key = process.env.COINBASE_API_KEY
  const secret = process.env.COINBASE_API_SECRET
  if (!key || !secret) return { ok: false, data: null }
  const ts = Math.floor(Date.now() / 1000).toString()
  const sig = createHmac('sha256', secret).update(`${ts}POST${path}${body}`).digest('hex')
  const res = await fetch(`https://api.coinbase.com${path}`, {
    method: 'POST',
    headers: {
      'CB-ACCESS-KEY': key, 'CB-ACCESS-SIGN': sig, 'CB-ACCESS-TIMESTAMP': ts,
      'Content-Type': 'application/json',
    },
    body,
    signal: AbortSignal.timeout(8_000),
  })
  return { ok: res.ok, data: await res.json().catch(() => null) as Record<string, unknown> | null }
}

/**
 * Coinbase has no order-modify: reduce = cancel the old leg, resubmit at the
 * filled quantity. The new client_order_id is DERIVED deterministically from
 * the old one plus the target quantity, so a repeated reconciliation pass
 * resubmits the same id and the broker dedupes.
 */
async function coinbaseReduce(
  intent: OrderIntentRow,
  newQuantity: number
): Promise<{ ok: boolean; newBrokerOrderId?: string }> {
  if (!intent.broker_order_id || !intent.symbol || !intent.side) return { ok: false }

  const cancelled = await coinbaseCancel(intent.broker_order_id)
  if (!cancelled) return { ok: false }

  const side = intent.side.toUpperCase()
  const configuration =
    intent.leg === 'stop' && intent.stop_price != null
      ? {
          stop_limit_stop_limit_gtc: {
            base_size: newQuantity.toString(),
            stop_price: intent.stop_price.toFixed(8),
            limit_price: (intent.limit_price ?? intent.stop_price).toFixed(8),
            stop_direction: side === 'SELL' ? 'STOP_DIRECTION_STOP_DOWN' : 'STOP_DIRECTION_STOP_UP',
          },
        }
      : intent.leg === 'take_profit' && intent.limit_price != null
        ? {
            limit_limit_gtc: {
              base_size: newQuantity.toString(),
              limit_price: intent.limit_price.toFixed(8),
            },
          }
        : null
  if (!configuration) return { ok: false }

  const body = JSON.stringify({
    client_order_id: `${intent.client_order_id}-r${newQuantity}`,
    product_id: `${intent.symbol}-USD`,
    side,
    order_configuration: configuration,
  })
  const { ok, data } = await coinbasePost('/api/v3/brokerage/orders', body)
  const newId = ((data?.success_response as Record<string, unknown> | undefined)?.order_id as string | undefined)
  return ok && newId ? { ok: true, newBrokerOrderId: newId } : { ok: false }
}

export function defaultReconcilerOps(): ReconcilerOps {
  return {
    async getOrderStatus(broker, brokerOrderId) {
      if (broker === 'coinbase') return coinbaseOrderStatus(brokerOrderId)
      return { status: 'unknown' }
    },
    async cancelOrder(broker, brokerOrderId) {
      if (broker === 'coinbase') return coinbaseCancel(brokerOrderId)
      return false
    },
    async reduceOrderSize(intent, newQuantity) {
      if (intent.broker === 'coinbase') return coinbaseReduce(intent, newQuantity)
      return { ok: false }
    },
  }
}
