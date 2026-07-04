/**
 * Broker capability model + safe sizing — adapters declare what they can
 * really do, execution refuses everything else instead of guessing:
 *
 *  - OANDA: refuses USD-notional → base-currency-units guess
 *  - IBKR: refuses the notional/100 "assume $100 share price" placeholder
 *  - Kraken: refuses orders without base-currency volume
 *  - Coinbase: refuses brackets whose protective legs cannot be placed
 *    (notional-only entry would fill WITHOUT a stop-loss)
 *  - Tastytrade / Deribit / Kalshi: refuse silent default-to-1-contract
 *  - Router: enforces checkOrderSupport + liveReady before any adapter call
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  AlpacaAdapter,
  KrakenAdapter,
  CoinbaseAdapter,
  OandaAdapter,
  IBKRAdapter,
  WebullAdapter,
  TastytradeAdapter,
  DeribitAdapter,
} from '@/lib/broker-adapters/adapters'
import { KalshiAdapter } from '@/lib/integrations/kalshi/KalshiAdapter'
import { BROKER_ADAPTERS, submitOrder } from '@/lib/broker-adapters/router'
import { preExecutionGuard } from '@/lib/broker-adapters/execution-guard'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function fetchTrap() {
  const spy = vi.fn(async () => { throw new Error('network call attempted — sizing guard failed') })
  vi.stubGlobal('fetch', spy)
  return spy
}


// execute()/placeBracketOrder() are now FINAL gates that short-circuit in the
// paper phase before adapter code runs. The per-adapter sizing guards below
// are LIVE-mode defense-in-depth, so these tests call the protected
// implementations directly; the public gate is covered further down.
function doExecute(adapter: object, params: Record<string, unknown>) {
  return (adapter as unknown as { doExecute(p: unknown): Promise<{ status: string; reason?: string }> }).doExecute(params)
}
function doBracket(adapter: object, params: Record<string, unknown>) {
  return (adapter as unknown as { doPlaceBracketOrder(p: unknown): Promise<{ status: string; reason?: string }> }).doPlaceBracketOrder(params)
}

describe('blocked unsafe sizing paths (one test per path)', () => {
  it('OANDA execute refuses notional-only sizing (units are base-currency, not USD)', async () => {
    vi.stubEnv('OANDA_API_KEY', 'k')
    vi.stubEnv('OANDA_ACCOUNT_ID', 'a')
    const spy = fetchTrap()
    const r = await doExecute(new OandaAdapter(), { symbol: 'EUR/USD', asset_class: 'forex', side: 'buy', notional_usd: 500 })
    expect(r.status).toBe('skipped')
    expect(r.reason).toContain('base-currency units')
    expect(spy).not.toHaveBeenCalled()
  })

  it('OANDA bracket refuses notional-only sizing', async () => {
    vi.stubEnv('OANDA_API_KEY', 'k')
    vi.stubEnv('OANDA_ACCOUNT_ID', 'a')
    const spy = fetchTrap()
    const r = await doBracket(new OandaAdapter(), {
      symbol: 'EUR/USD', asset_class: 'forex', side: 'buy', notional_usd: 500, stop_price: 1.05,
    })
    expect(r.status).toBe('skipped')
    expect(spy).not.toHaveBeenCalled()
  })

  it('IBKR execute refuses the notional/100 placeholder', async () => {
    vi.stubEnv('IBKR_ACCOUNT_ID', 'a')
    vi.stubEnv('IBKR_API_URL', 'http://localhost:5000')
    const spy = fetchTrap()
    const r = await doExecute(new IBKRAdapter(), { symbol: 'AAPL', asset_class: 'stock', side: 'buy', notional_usd: 500 })
    expect(r.status).toBe('skipped')
    expect(r.reason).toContain('explicit quantity')
    expect(spy).not.toHaveBeenCalled()
  })

  it('IBKR bracket refuses the notional/100 placeholder', async () => {
    vi.stubEnv('IBKR_ACCOUNT_ID', 'a')
    vi.stubEnv('IBKR_API_URL', 'http://localhost:5000')
    const spy = fetchTrap()
    const r = await doBracket(new IBKRAdapter(), {
      symbol: 'AAPL', asset_class: 'stock', side: 'buy', notional_usd: 500, stop_price: 90,
    })
    expect(r.status).toBe('skipped')
    expect(spy).not.toHaveBeenCalled()
  })

  it('Kraken execute refuses orders without base-currency volume', async () => {
    vi.stubEnv('KRAKEN_API_KEY', 'k')
    vi.stubEnv('KRAKEN_API_SECRET', Buffer.from('secret').toString('base64'))
    const spy = fetchTrap()
    const r = await doExecute(new KrakenAdapter(), { symbol: 'BTC', asset_class: 'crypto', side: 'buy', notional_usd: 500 })
    expect(r.status).toBe('skipped')
    expect(r.reason).toContain('base-currency units')
    expect(spy).not.toHaveBeenCalled()
  })

  it('Coinbase bracket refuses notional-only entry that would fill without stop coverage', async () => {
    vi.stubEnv('COINBASE_API_KEY', 'k')
    vi.stubEnv('COINBASE_API_SECRET', 's')
    const spy = fetchTrap()
    const r = await doBracket(new CoinbaseAdapter(), {
      symbol: 'BTC', asset_class: 'crypto', side: 'buy', notional_usd: 500, stop_price: 90_000,
    })
    expect(r.status).toBe('skipped')
    expect(r.reason).toContain('without stop coverage')
    expect(spy).not.toHaveBeenCalled()
  })

  it('Coinbase execute refuses zero-size orders (no notional, no quantity)', async () => {
    vi.stubEnv('COINBASE_API_KEY', 'k')
    vi.stubEnv('COINBASE_API_SECRET', 's')
    const spy = fetchTrap()
    const r = await doExecute(new CoinbaseAdapter(), { symbol: 'BTC', asset_class: 'crypto', side: 'buy' })
    expect(r.status).toBe('skipped')
    expect(spy).not.toHaveBeenCalled()
  })

  it('Tastytrade execute refuses the silent default-to-1-contract', async () => {
    vi.stubEnv('TASTYTRADE_SESSION_TOKEN', 't')
    vi.stubEnv('TASTYTRADE_ACCOUNT_NUMBER', 'a')
    const spy = fetchTrap()
    const r = await doExecute(new TastytradeAdapter(), { symbol: 'SPY', asset_class: 'stock', side: 'buy', notional_usd: 500 })
    expect(r.status).toBe('skipped')
    expect(r.reason).toContain('default to 1 contract')
    expect(spy).not.toHaveBeenCalled()
  })

  it('Deribit execute refuses the silent default amount of 1', async () => {
    vi.stubEnv('DERIBIT_CLIENT_ID', 'c')
    vi.stubEnv('DERIBIT_CLIENT_SECRET', 's')
    const spy = fetchTrap()
    const r = await doExecute(new DeribitAdapter(), { symbol: 'BTC-PERPETUAL', asset_class: 'crypto_futures', side: 'buy', notional_usd: 500 })
    expect(r.status).toBe('skipped')
    expect(spy).not.toHaveBeenCalled()
  })

  it('Webull execute refuses orders without quantity', async () => {
    vi.stubEnv('WEBULL_ACCESS_TOKEN', 't')
    vi.stubEnv('WEBULL_ACCOUNT_ID', 'a')
    const spy = fetchTrap()
    const r = await doExecute(new WebullAdapter(), { symbol: 'AAPL', asset_class: 'stock', side: 'buy', notional_usd: 500 })
    expect(r.status).toBe('skipped')
    expect(spy).not.toHaveBeenCalled()
  })

  it('Kalshi refuses notional sizing without a limit price (no 0.50 guess)', async () => {
    vi.stubEnv('KALSHI_API_KEY', 'k')
    vi.stubEnv('KALSHI_API_SECRET', 's')
    const spy = fetchTrap()
    const r = await doExecute(new KalshiAdapter(), { symbol: 'KALSHI:KXHIGH-25APR28-T70', asset_class: 'prediction_market', side: 'buy', notional_usd: 100 })
    expect(r.status).toBe('skipped')
    expect(r.reason).toContain('price guess')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('FINAL in-adapter gate — no direct caller can bypass (audit residue 1)', () => {
  it('direct adapter.execute() in the paper phase never reaches broker HTTP, even with keys', async () => {
    vi.stubEnv('ALPACA_API_KEY', 'fake')
    vi.stubEnv('ALPACA_SECRET_KEY', 'fake')
    const spy = fetchTrap()

    const r = await new AlpacaAdapter().execute({
      symbol: 'SPY', asset_class: 'stock', side: 'buy', notional_usd: 100,
    })

    expect(r.status).toBe('skipped')
    expect(r.reason).toContain('live trading disabled')
    expect(spy).not.toHaveBeenCalled()
  })

  it('with the master switch ON, direct execute() still refuses — not liveReady', async () => {
    vi.stubEnv('LIVE_TRADING_ENABLED', 'true')
    vi.stubEnv('ALPACA_API_KEY', 'fake')
    vi.stubEnv('ALPACA_SECRET_KEY', 'fake')
    const spy = fetchTrap()

    const r = await new AlpacaAdapter().execute({
      symbol: 'SPY', asset_class: 'stock', side: 'buy', notional_usd: 100,
    })

    expect(r.status).toBe('skipped')
    expect(r.reason).toContain('broker_not_live_ready')
    expect(spy).not.toHaveBeenCalled()
  })

  it('direct placeBracketOrder() is gated identically', async () => {
    vi.stubEnv('ALPACA_API_KEY', 'fake')
    vi.stubEnv('ALPACA_SECRET_KEY', 'fake')
    const spy = fetchTrap()

    const r = await new AlpacaAdapter().placeBracketOrder({
      symbol: 'SPY', asset_class: 'stock', side: 'buy', notional_usd: 100, stop_price: 90,
    })

    expect(r.status).toBe('skipped')
    expect(r.reason).toContain('live trading disabled')
    expect(spy).not.toHaveBeenCalled()
  })

  it('with switch ON + liveReady, capability violations still block at the gate', async () => {
    vi.stubEnv('LIVE_TRADING_ENABLED', 'true')
    const adapter = new OandaAdapter()
    // Simulate a sandbox-verified adapter WITHOUT touching source constants.
    vi.spyOn(adapter, 'config', 'get').mockReturnValue({
      ...new OandaAdapter().config,
      capabilities: { ...new OandaAdapter().config.capabilities, liveReady: true },
    })
    const spy = fetchTrap()

    // OANDA does not accept USD-notional sizing — gate refuses before doExecute.
    const r = await adapter.execute({ symbol: 'EUR/USD', asset_class: 'forex', side: 'buy', notional_usd: 500 })
    expect(r.status).toBe('skipped')
    expect(r.reason).toContain('capability_blocked')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('capability declarations', () => {
  it('every adapter declares capabilities and none is liveReady during the paper phase', () => {
    for (const adapter of BROKER_ADAPTERS) {
      expect(adapter.config.capabilities, adapter.config.id).toBeDefined()
      expect(adapter.config.capabilities.liveReady, `${adapter.config.id} must not be liveReady`).toBe(false)
    }
    expect(new KalshiAdapter().config.capabilities.liveReady).toBe(false)
  })

  it('checkOrderSupport blocks limit orders on market-only adapters', () => {
    const reason = new OandaAdapter().checkOrderSupport({
      symbol: 'EUR/USD', asset_class: 'forex', side: 'buy', order_type: 'limit', quantity: 100,
    })
    expect(reason).toContain('does not support limit orders')
  })

  it('checkOrderSupport blocks notional sizing where unsupported and passes where supported', () => {
    expect(new IBKRAdapter().checkOrderSupport({
      symbol: 'AAPL', asset_class: 'stock', side: 'buy', notional_usd: 500,
    })).toContain('notional')
    expect(new AlpacaAdapter().checkOrderSupport({
      symbol: 'AAPL', asset_class: 'stock', side: 'buy', notional_usd: 500,
    })).toBeNull()
  })
})

describe('router enforcement (with the master switch forced on)', () => {
  function benignSupabase() {
    const from = vi.fn(() => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = vi.fn(() => chain)
      chain.single = vi.fn(async () => ({ data: null, error: null }))
      chain.insert = vi.fn(async () => ({ error: null }))
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
      return chain
    })
    return { from } as never
  }

  it('live route is refused when the selected adapter is not liveReady', async () => {
    vi.stubEnv('LIVE_TRADING_ENABLED', 'true')
    vi.stubEnv('ALPACA_API_KEY', 'k')
    vi.stubEnv('ALPACA_SECRET_KEY', 's')
    const spy = vi.spyOn(AlpacaAdapter.prototype, 'execute')

    const guard = await preExecutionGuard({ supabase: benignSupabase(), userId: 'user-1' })
    expect(guard.ok).toBe(true)
    if (!guard.ok) return

    const r = await submitOrder(
      { symbol: 'SPY', asset_class: 'stock', side: 'buy', notional_usd: 100 },
      guard.token
    )
    expect(r.status).toBe('skipped')
    expect(r.reason).toContain('broker_not_live_ready')
    expect(spy).not.toHaveBeenCalled()
  })

  it('capability violations are blocked at the router before the adapter runs', async () => {
    vi.stubEnv('LIVE_TRADING_ENABLED', 'true')
    vi.stubEnv('OANDA_API_KEY', 'k')
    vi.stubEnv('OANDA_ACCOUNT_ID', 'a')
    const spy = vi.spyOn(OandaAdapter.prototype, 'execute')

    const guard = await preExecutionGuard({ supabase: benignSupabase(), userId: 'user-1' })
    if (!guard.ok) throw new Error('guard blocked')

    const r = await submitOrder(
      { symbol: 'EUR/USD', asset_class: 'forex', side: 'buy', notional_usd: 500 },
      guard.token
    )
    expect(r.status).toBe('skipped')
    expect(r.reason).toContain('capability_blocked')
    expect(spy).not.toHaveBeenCalled()
  })
})
