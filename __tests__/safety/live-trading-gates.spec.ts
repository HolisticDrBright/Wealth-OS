/**
 * Live-trading safety gates — the tests that make the paper phase provable.
 *
 *  1. Both broker routers REFUSE ungated submitOrder calls (no guard token,
 *     forged token, expired token).
 *  2. Master switch: with a VALID token and broker API keys present in the
 *     environment, paper mode still never reaches a real adapter.
 *  3. Hard live approval: paper_trading / backtest_ready / stub / unknown
 *     strategies can never be live-approved; live_candidate additionally
 *     requires user_enabled_strategies.live_enabled === true (is_enabled is
 *     never a live signal); DB read errors fail closed.
 *  4. BasePipelineStrategy.execute: real-adapter paths are blocked by the
 *     master switch, and by the approval gate even when the switch is on.
 *  5. Jurisdiction: a US user must never be routed to Polymarket, even though
 *     it is both primary and fallback for the polymarket asset class.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Registry passthrough mock — lets the approved-path test pretend one key is
// live_candidate (none are in the real registry, by design, during the paper
// phase).
const registryOverride = vi.hoisted(() => ({ key: null as string | null, maturity: null as string | null }))

vi.mock('@/lib/strategies/strategy-registry', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/strategies/strategy-registry')>()
  return {
    ...orig,
    getStrategyConfig: (key: never) => {
      const cfg = orig.getStrategyConfig(key)
      if (registryOverride.key === key && registryOverride.maturity) {
        return { ...cfg, maturityStatus: registryOverride.maturity }
      }
      return cfg
    },
  }
})

import {
  preExecutionGuard,
  isGuardTokenValid,
  checkLiveApproval,
  liveTradingEnabled,
  PAPER_PHASE_REASON,
  type GuardToken,
} from '@/lib/broker-adapters/execution-guard'
import { submitOrder as submitViaAdapterRouter } from '@/lib/broker-adapters/router'
import { submitOrder as submitViaLegacyRouter } from '@/lib/broker-router'
import { AlpacaAdapter, OandaAdapter, PolymarketAdapter } from '@/lib/broker-adapters/adapters'
import { selectBroker } from '@/lib/brokers/asset-broker-routing'
import { FxTrendfollowingStrategy } from '@/lib/strategies/impl/forex/stubs'
import type { Opportunity } from '@/lib/strategies/pipeline-types'

// ─── Supabase mock: benign kill-switch state, per-table row overrides ─────────

function makeSupabase(tableRows: Record<string, unknown[]> = {}) {
  const inserts: Record<string, unknown[]> = {}
  const from = vi.fn((table: string) => {
    const rows = tableRows[table] ?? []
    const result = { data: rows, error: null }
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit', 'in', 'gte', 'lte']) {
      chain[m] = vi.fn(() => chain)
    }
    chain.single = vi.fn(async () => ({ data: rows[0] ?? null, error: null }))
    chain.insert = vi.fn(async (row: unknown) => {
      ;(inserts[table] ??= []).push(row)
      return { data: null, error: null }
    })
    chain.then = (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject)
    return chain
  })
  return { client: { from, auth: {} } as never, from, inserts }
}

function makeOpp(): Opportunity {
  return {
    strategyKey: 'fx_trendfollowing',
    symbol: 'EUR/USD',
    assetClass: 'forex',
    direction: 'long',
    expectedReturn: 0.02,
    strength: 0.8,
    metadata: {},
  } as never
}

async function mintToken(userId = 'user-1', strategyKey?: string): Promise<GuardToken> {
  const { client } = makeSupabase()
  const verdict = await preExecutionGuard({ supabase: client, userId, strategyKey })
  if (!verdict.ok) throw new Error(`guard unexpectedly blocked: ${verdict.reason}`)
  return verdict.token
}

beforeEach(() => {
  registryOverride.key = null
  registryOverride.maturity = null
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// ─── 1. Routers refuse ungated submissions ────────────────────────────────────

describe('router guard-token enforcement', () => {
  const order = { symbol: 'SPY', asset_class: 'stock', side: 'buy' as const, notional_usd: 100 }

  it('adapter router refuses a submission with no token', async () => {
    const result = await submitViaAdapterRouter(order)
    expect(result.status).toBe('failed')
    expect(result.reason).toContain('ungated submission refused')
  })

  it('legacy router refuses a submission with no token', async () => {
    const result = await submitViaLegacyRouter(order)
    expect(result.status).toBe('failed')
    expect(result.reason).toContain('ungated submission refused')
  })

  it('a forged token object is rejected — WeakSet membership cannot be faked', async () => {
    const forged: GuardToken = { userId: 'user-1', issuedAt: Date.now() }
    expect(isGuardTokenValid(forged)).toBe(false)
    const result = await submitViaAdapterRouter(order, forged)
    expect(result.status).toBe('failed')
    expect(result.reason).toContain('ungated submission refused')
  })

  it('tokens expire after the 60s TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-03T12:00:00Z'))
    const token = await mintToken()
    expect(isGuardTokenValid(token)).toBe(true)
    vi.setSystemTime(new Date('2026-07-03T12:01:01Z'))
    expect(isGuardTokenValid(token)).toBe(false)
    const result = await submitViaAdapterRouter(order, token)
    expect(result.status).toBe('failed')
  })

  it('preExecutionGuard refuses to mint when the kill switch is on', async () => {
    const { client } = makeSupabase({
      system_flags: [{ user_id: null, enabled: true, reason: 'ops halt' }],
    })
    const verdict = await preExecutionGuard({ supabase: client, userId: 'user-1' })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('trading_halted')
  })
})

// ─── 2. Master switch — env keys present, still no live execution ─────────────

describe('LIVE_TRADING_ENABLED master switch', () => {
  it('is off by default (paper validation phase)', () => {
    expect(process.env.LIVE_TRADING_ENABLED).not.toBe('true')
    expect(liveTradingEnabled()).toBe(false)
  })

  it('adapter router skips with a valid token when the switch is off — even with API keys in env', async () => {
    // Simulate real credentials present in the environment.
    vi.stubEnv('ALPACA_API_KEY', 'fake-key-id')
    vi.stubEnv('ALPACA_API_SECRET', 'fake-secret')
    const executeSpy = vi.spyOn(AlpacaAdapter.prototype, 'execute')

    const token = await mintToken()
    const result = await submitViaAdapterRouter(
      { symbol: 'SPY', asset_class: 'stock', side: 'buy', notional_usd: 100 },
      token
    )

    expect(result.status).toBe('skipped')
    expect(result.reason).toBe(PAPER_PHASE_REASON)
    expect(executeSpy).not.toHaveBeenCalled()
  })

  it('legacy router skips with a valid token when the switch is off — even with API keys in env', async () => {
    vi.stubEnv('ALPACA_API_KEY', 'fake-key-id')
    vi.stubEnv('ALPACA_API_SECRET', 'fake-secret')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const token = await mintToken()
    const result = await submitViaLegacyRouter(
      { symbol: 'SPY', asset_class: 'stock', side: 'buy', notional_usd: 100 },
      token
    )

    expect(result.status).toBe('skipped')
    expect(result.reason).toBe(PAPER_PHASE_REASON)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

// ─── 3. Hard live-approval gate ───────────────────────────────────────────────

describe('checkLiveApproval', () => {
  it('denies unknown strategy keys', async () => {
    const { client } = makeSupabase()
    const v = await checkLiveApproval(client, 'user-1', 'not_a_real_strategy')
    expect(v.approved).toBe(false)
    expect(v.reason).toContain('unknown strategy key')
  })

  it('denies paper_trading maturity even when live_enabled=true in the DB', async () => {
    const { client } = makeSupabase({
      user_enabled_strategies: [{ live_enabled: true }],
    })
    // fx_trendfollowing is paper_trading in the real registry.
    const v = await checkLiveApproval(client, 'user-1', 'fx_trendfollowing')
    expect(v.approved).toBe(false)
    expect(v.reason).toContain('not live-approved')
  })

  it('denies live_candidate when live_enabled is false or missing — is_enabled is never a live signal', async () => {
    registryOverride.key = 'fx_trendfollowing'
    registryOverride.maturity = 'live_candidate'

    const noRow = makeSupabase({ user_enabled_strategies: [] })
    const vNoRow = await checkLiveApproval(noRow.client, 'user-1', 'fx_trendfollowing')
    expect(vNoRow.approved).toBe(false)

    const enabledButNotLive = makeSupabase({
      user_enabled_strategies: [{ is_enabled: true, live_enabled: false }],
    })
    const vNotLive = await checkLiveApproval(enabledButNotLive.client, 'user-1', 'fx_trendfollowing')
    expect(vNotLive.approved).toBe(false)
    expect(vNotLive.reason).toContain('live_enabled is not true')
  })

  it('fails closed when the live_enabled read errors', async () => {
    registryOverride.key = 'fx_trendfollowing'
    registryOverride.maturity = 'live_candidate'
    const from = vi.fn(() => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) chain[m] = vi.fn(() => chain)
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: { message: 'relation missing' } }).then(resolve)
      return chain
    })
    const v = await checkLiveApproval({ from } as never, 'user-1', 'fx_trendfollowing')
    expect(v.approved).toBe(false)
    expect(v.reason).toContain('fail closed')
  })

  it('approves ONLY live_candidate + live_enabled=true', async () => {
    registryOverride.key = 'fx_trendfollowing'
    registryOverride.maturity = 'live_candidate'
    const { client } = makeSupabase({
      user_enabled_strategies: [{ live_enabled: true }],
    })
    const v = await checkLiveApproval(client, 'user-1', 'fx_trendfollowing')
    expect(v.approved).toBe(true)
  })

  it('no strategy in the real registry is live_candidate during the paper phase', async () => {
    const { STRATEGY_REGISTRY_CONFIG } = await vi.importActual<typeof import('@/lib/strategies/strategy-registry')>(
      '@/lib/strategies/strategy-registry'
    )
    for (const cfg of Object.values(STRATEGY_REGISTRY_CONFIG)) {
      expect((cfg as { maturityStatus: string }).maturityStatus).not.toBe('live_candidate')
    }
  })
})

// ─── 4. Strategy execute() paths never reach real adapters ────────────────────

describe('BasePipelineStrategy live gate', () => {
  const size = { fraction: 0.05, notionalUsd: 500, rationale: 'test' }

  it('paper phase: execute() skips before any adapter — even with broker keys in env', async () => {
    vi.stubEnv('OANDA_API_KEY', 'fake')
    vi.stubEnv('OANDA_ACCOUNT_ID', 'fake')
    const executeSpy = vi.spyOn(OandaAdapter.prototype, 'execute')

    const strat = new FxTrendfollowingStrategy()
    const { client } = makeSupabase()
    const result = await strat.execute(makeOpp(), size, 'user-1', client)

    expect(result.status).toBe('skipped')
    expect(result.error).toBe(PAPER_PHASE_REASON)
    expect(executeSpy).not.toHaveBeenCalled()
  })

  it('switch ON but paper_trading maturity: blocked by the approval gate + audited', async () => {
    vi.stubEnv('LIVE_TRADING_ENABLED', 'true')
    const executeSpy = vi.spyOn(OandaAdapter.prototype, 'execute')

    const strat = new FxTrendfollowingStrategy()
    const supa = makeSupabase({ user_enabled_strategies: [{ live_enabled: true }] })
    const result = await strat.execute(makeOpp(), size, 'user-1', supa.client)

    expect(result.status).toBe('skipped')
    expect(result.error).toContain('live_approval_gate')
    expect(executeSpy).not.toHaveBeenCalled()
    const audit = (supa.inserts.audit_logs ?? [])[0] as { metadata?: { blocked_by?: string } }
    expect(audit?.metadata?.blocked_by).toBe('live_approval_gate')
  })
})

// ─── 5. Jurisdiction — US users never reach Polymarket ────────────────────────

describe('jurisdiction routing', () => {
  it('US user, polymarket asset class (primary AND fallback are polymarket) → no broker + reason', () => {
    const sel = selectBroker({ assetClass: 'polymarket', userJurisdiction: 'us' })
    expect(sel.broker).toBeNull()
    if (sel.broker === null) {
      expect(sel.reason).toBe('no_legal_broker')
      expect(sel.detail).toContain('polymarket')
      expect(sel.detail).toContain('us')
    }
  })

  it('non-US user still routes polymarket normally', () => {
    const sel = selectBroker({ assetClass: 'polymarket', userJurisdiction: 'eu' })
    expect(sel.broker).toBe('polymarket')
  })

  it('adapter-level jurisdiction: PolymarketAdapter disallows US', () => {
    const adapter = new PolymarketAdapter()
    expect(adapter.isAllowedJurisdiction('US')).toBe(false)
  })
})
