/**
 * Kalshi broker adapter.
 * Kalshi is a CFTC-regulated Designated Contract Market (DCM).
 * legalStatus: us_retail_ok
 *
 * API docs: https://trading-api.readme.io/reference/getting-started
 */

import { randomUUID } from 'crypto'
import type { OrderParams, BrokerResult, BrokerConfig } from '@/lib/broker-adapters/types'
import { BrokerAdapter } from '@/lib/broker-adapters/types'

const KALSHI_BASE = process.env.KALSHI_BASE_URL ?? 'https://trading-api.kalshi.com/trade-api/v2'

export class KalshiAdapter extends BrokerAdapter {
  readonly config: BrokerConfig = {
    id: 'kalshi',
    displayName: 'Kalshi',
    assetClasses: ['polymarket', 'prediction_market'],
    requiredEnvVars: ['KALSHI_API_KEY', 'KALSHI_API_SECRET'],
    capabilities: {
      supportsMarket: true, supportsLimit: true, supportsBracket: false,
      supportsCancel: false, supportsStatus: false,
      // Notional→contracts needs a real limit price; guarded in execute().
      supportsNotionalSizing: true, supportsQuantitySizing: true,
      liveReady: false,
    },
  }

  async execute(params: OrderParams): Promise<BrokerResult> {
    const key = process.env.KALSHI_API_KEY
    const secret = process.env.KALSHI_API_SECRET
    if (!key || !secret) {
      return { status: 'skipped', reason: 'KALSHI_API_KEY not configured' }
    }
    if (!params.quantity && !params.notional_usd) {
      return { status: 'skipped', broker: 'kalshi', reason: 'order must specify quantity or notional_usd — refusing to default to 1 contract' }
    }
    if (!params.quantity && params.notional_usd && !params.limit_price) {
      return { status: 'skipped', broker: 'kalshi', reason: 'notional sizing needs a limit_price to convert to contracts — refusing 0.50 price guess' }
    }

    try {
      // Kalshi uses email+password auth; advanced token auth available via API key
      // Market ticker format: KXHIGH-25APR28-T70 (series-date-strike)
      const ticker = params.symbol.startsWith('KALSHI:')
        ? params.symbol.slice(7)
        : params.symbol

      // Convert notional to contracts (Kalshi contracts are $0.01 - $1.00 each)
      const price = params.limit_price ?? 0.5
      const count = params.quantity
        ?? Math.max(1, Math.floor((params.notional_usd as number) / Math.max(price, 0.01)))

      const body = {
        ticker,
        // Idempotency: deterministic id from order-intents when provided;
        // random UUID otherwise — never a timestamp (collides across workers).
        client_order_id: params.client_order_id ?? `wos-${randomUUID().slice(0, 20)}`,
        side: params.side === 'buy' ? 'yes' : 'no',
        action: 'buy',
        count,
        type: params.order_type === 'limit' ? 'limit' : 'market',
        ...(params.order_type === 'limit' && price
          ? { yes_price: Math.round(price * 100) }  // Kalshi uses cents
          : {}),
      }

      const res = await fetch(`${KALSHI_BASE}/portfolio/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8_000),
      })

      if (!res.ok) {
        const err = await res.text()
        return { status: 'failed', broker: 'kalshi', error: err }
      }

      const data = await res.json() as { order?: { order_id?: string } }
      return {
        status: 'submitted',
        broker: 'kalshi',
        broker_order_id: data.order?.order_id,
      }
    } catch (err) {
      return { status: 'failed', broker: 'kalshi', error: String(err) }
    }
  }
}
