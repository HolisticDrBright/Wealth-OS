/**
 * TIER 1 tests: BrokerAdapter bracket order interface.
 *
 * Tests that:
 * - AlpacaAdapter.placeBracketOrder sends correct payload (bracket order_class)
 * - CoinbaseAdapter.placeBracketOrder places separate entry + stop + TP orders
 * - OandaAdapter.placeBracketOrder uses stopLossOnFill / takeProfitOnFill
 * - BrokerAdapter.cancelBracket / modifyStop / modifyTarget default to skipped for
 *   adapters that don't override them
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AlpacaAdapter } from '@/lib/broker-adapters/adapters'
import { CoinbaseAdapter } from '@/lib/broker-adapters/adapters'
import { OandaAdapter } from '@/lib/broker-adapters/adapters'
import type { BracketParams } from '@/lib/broker-adapters/types'

// ─── Mock fetch ───────────────────────────────────────────────────────────────

function mockFetch(data: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(data),
  })
}

const ALPACA_ENV = {
  ALPACA_API_KEY: 'test-key',
  ALPACA_SECRET_KEY: 'test-secret',
  ALPACA_LIVE: 'false',
}

const COINBASE_ENV = {
  COINBASE_API_KEY: 'test-key',
  COINBASE_API_SECRET: 'test-secret',
}

const OANDA_ENV = {
  OANDA_API_KEY: 'test-key',
  OANDA_ACCOUNT_ID: 'test-account',
  OANDA_PRACTICE: 'true',
}

function setEnv(vars: Record<string, string>) {
  Object.assign(process.env, vars)
}

function clearEnv(vars: Record<string, string>) {
  for (const k of Object.keys(vars)) delete process.env[k]
}


// The public placeBracketOrder is now a FINAL live-safety gate (paper phase →
// skipped before any HTTP). These tests exercise the broker-specific payload
// mechanics, so they call the protected implementation directly; the gate
// itself is covered in __tests__/safety/broker-capabilities.spec.ts.
function bracket(adapter: object, params: BracketParams) {
  return (adapter as unknown as { doPlaceBracketOrder(p: BracketParams): Promise<import('@/lib/broker-adapters/types').BracketResult> })
    .doPlaceBracketOrder(params)
}


// cancel/modify are now gated like execute() (paper phase short-circuits) —
// mechanics tests call the protected implementations; the gate itself is
// covered in __tests__/safety/broker-capabilities.spec.ts.
function doCancel(adapter: object, id: string) {
  return (adapter as unknown as { doCancelBracket(i: string): Promise<{ status: string; broker_order_id?: string; reason?: string }> }).doCancelBracket(id)
}
function doStop(adapter: object, id: string, px: number) {
  return (adapter as unknown as { doModifyStop(i: string, p: number): Promise<{ status: string; broker_order_id?: string }> }).doModifyStop(id, px)
}
function doTarget(adapter: object, id: string, px: number) {
  return (adapter as unknown as { doModifyTarget(i: string, p: number): Promise<{ status: string; broker_order_id?: string }> }).doModifyTarget(id, px)
}

// ─── Alpaca ───────────────────────────────────────────────────────────────────

describe('AlpacaAdapter.placeBracketOrder', () => {
  let adapter: AlpacaAdapter

  beforeEach(() => {
    adapter = new AlpacaAdapter()
    setEnv(ALPACA_ENV)
  })

  afterEach(() => clearEnv(ALPACA_ENV))

  it('sends order_class=bracket with stop_loss and take_profit legs', async () => {
    const fetchMock = mockFetch({
      id: 'order-123',
      legs: [
        { id: 'stop-id', order_type: 'stop' },
        { id: 'tp-id', order_type: 'limit' },
      ],
    })
    global.fetch = fetchMock

    const params: BracketParams = {
      symbol: 'AAPL',
      asset_class: 'stock',
      side: 'buy',
      quantity: 10,
      stop_price: 180,
      take_profit_price: 220,
    }
    const result = await bracket(adapter, params)

    expect(result.status).toBe('submitted')
    expect(result.broker).toBe('alpaca')
    expect(result.parent_order_id).toBe('order-123')

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.order_class).toBe('bracket')
    expect(body.stop_loss.stop_price).toBe('180')
    expect(body.take_profit.limit_price).toBe('220')
  })

  it('returns failed when API returns error', async () => {
    global.fetch = mockFetch({ message: 'insufficient funds' }, false, 422)

    const result = await bracket(adapter, {
      symbol: 'AAPL', asset_class: 'stock', side: 'buy', quantity: 10,
      stop_price: 180,
    })

    expect(result.status).toBe('failed')
    expect(result.error).toContain('insufficient funds')
  })

  it('returns skipped when env vars missing', async () => {
    clearEnv(ALPACA_ENV)
    const result = await bracket(adapter, {
      symbol: 'AAPL', asset_class: 'stock', side: 'buy', quantity: 1, stop_price: 100,
    })
    expect(result.status).toBe('skipped')
  })

  it('cancelBracket sends DELETE to /v2/orders/:id', async () => {
    const fetchMock = mockFetch({}, true, 204)
    global.fetch = fetchMock
    const result = await doCancel(adapter, 'order-123')
    expect(result.status).toBe('submitted')
    expect(fetchMock.mock.calls[0][0]).toContain('/v2/orders/order-123')
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
  })

  it('modifyStop sends PATCH with stop_price', async () => {
    const fetchMock = mockFetch({ id: 'stop-id' }, true)
    global.fetch = fetchMock
    const result = await doStop(adapter, 'stop-id', 185)
    expect(result.status).toBe('submitted')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.stop_price).toBe('185')
  })

  it('modifyTarget sends PATCH with limit_price', async () => {
    const fetchMock = mockFetch({ id: 'tp-id' }, true)
    global.fetch = fetchMock
    const result = await doTarget(adapter, 'tp-id', 225)
    expect(result.status).toBe('submitted')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.limit_price).toBe('225')
  })
})

// ─── Coinbase ─────────────────────────────────────────────────────────────────

describe('CoinbaseAdapter.placeBracketOrder', () => {
  let adapter: CoinbaseAdapter
  let callCount: number

  beforeEach(() => {
    adapter = new CoinbaseAdapter()
    setEnv(COINBASE_ENV)
    callCount = 0
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          success_response: { order_id: `order-${callCount}` },
        }),
      })
    })
  })

  afterEach(() => clearEnv(COINBASE_ENV))

  it('places 3 separate orders (entry + stop + take-profit)', async () => {
    const result = await bracket(adapter, {
      symbol: 'BTC',
      asset_class: 'crypto',
      side: 'buy',
      quantity: 0.1,
      stop_price: 50_000,
      take_profit_price: 70_000,
    })

    expect(result.status).toBe('submitted')
    expect(callCount).toBe(3)  // entry + stop + tp
    expect(result.parent_order_id).toBe('order-1')
    expect(result.stop_order_id).toBe('order-2')
    expect(result.take_profit_order_id).toBe('order-3')
  })

  it('returns failed if entry order fails', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error_response: { message: 'bad request' } }),
    })
    const result = await bracket(adapter, {
      symbol: 'BTC', asset_class: 'crypto', side: 'buy', quantity: 0.1, stop_price: 50_000,
    })
    expect(result.status).toBe('failed')
  })
})

// ─── OANDA ────────────────────────────────────────────────────────────────────

describe('OandaAdapter.placeBracketOrder', () => {
  let adapter: OandaAdapter

  beforeEach(() => {
    adapter = new OandaAdapter()
    setEnv(OANDA_ENV)
  })

  afterEach(() => clearEnv(OANDA_ENV))

  it('includes stopLossOnFill and takeProfitOnFill in order body', async () => {
    const fetchMock = mockFetch({
      orderFillTransaction: { tradeOpened: { tradeID: 'trade-123' } },
    })
    global.fetch = fetchMock

    const result = await bracket(adapter, {
      symbol: 'EUR_USD',
      asset_class: 'forex',
      side: 'buy',
      quantity: 10_000,
      stop_price: 1.0800,
      take_profit_price: 1.1200,
    })

    expect(result.status).toBe('submitted')
    expect(result.parent_order_id).toBe('trade-123')

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.order.stopLossOnFill.price).toBe('1.08000')
    expect(body.order.takeProfitOnFill.price).toBe('1.12000')
    expect(body.order.type).toBe('MARKET')
  })

  it('modifyStop updates stop via trade orders PUT', async () => {
    const fetchMock = mockFetch({ relatedTransactionIDs: ['tx-1'] })
    global.fetch = fetchMock

    const result = await doStop(adapter, 'trade-123', 1.075)
    expect(result.status).toBe('submitted')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.stopLoss.price).toBe('1.07500')
  })
})

// ─── Base adapter fallback (KrakenAdapter via default base) ───────────────────

describe('BrokerAdapter default bracket methods', () => {
  it('KrakenAdapter.cancelBracket returns skipped (no native cancel-bracket)', async () => {
    const { KrakenAdapter } = await import('@/lib/broker-adapters/adapters')
    const adapter = new KrakenAdapter()
    const result = await doCancel(adapter, 'txid-123')
    // Kraken does not override cancelBracket -> falls to base default
    expect(result.status).toBe('skipped')
  })
})
