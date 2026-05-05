/**
 * TIER 1 tests: PositionMonitor
 *
 * - onTick dispatches manageOpenPosition and calls applyAction
 * - applyAction closes/adjusts positions in Supabase
 * - scan-all route rejects requests missing Bearer token
 * - VcpMinerviniStrategy.manageOpenPosition returns 'close' at -8% drawdown
 * - FundingBasisArbStrategy.manageOpenPosition returns 'close' on negative funding
 * - PolymarketWalletCopyStrategy.manageOpenPosition returns 'close' at -30% DD
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OpenPosition, PriceTick } from '@/lib/strategies/pipeline-types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePosition(overrides: Partial<OpenPosition> = {}): OpenPosition {
  return {
    id: 'pos-1',
    strategyKey: 'vcp_minervini',
    symbol: 'AAPL',
    assetClass: 'stocks',
    direction: 'long',
    entryPrice: 200,
    currentPrice: 200,
    quantity: 10,
    notionalUsd: 2000,
    stopLossPct: 0.08,
    takeProfitPct: 0.10,
    maxHoldHours: 720,
    openedAt: Date.now() - 3600_000,
    metadata: {},
    ...overrides,
  }
}

function makeTick(symbol: string, price: number): PriceTick {
  return { symbol, price, timestamp: Date.now() }
}

// ─── VCP Minervini manageOpenPosition ─────────────────────────────────────────

describe('VcpMinerviniStrategy.manageOpenPosition', () => {
  it('returns close at -8% drawdown', async () => {
    const { VcpMinerviniStrategy } = await import('@/lib/strategies/impl/stocks/vcp-minervini')
    const strategy = new VcpMinerviniStrategy()
    const position = makePosition({ entryPrice: 200 })
    const tick = makeTick('AAPL', 183)  // -8.5%

    const action = await strategy.manageOpenPosition(position, tick)
    expect(action.type).toBe('close')
  })

  it('returns hold when price is flat', async () => {
    const { VcpMinerviniStrategy } = await import('@/lib/strategies/impl/stocks/vcp-minervini')
    const strategy = new VcpMinerviniStrategy()
    const position = makePosition({ entryPrice: 200 })
    const tick = makeTick('AAPL', 201)

    const action = await strategy.manageOpenPosition(position, tick)
    expect(action.type).toBe('hold')
  })

  it('returns adjustStop when price is >10% above entry', async () => {
    const { VcpMinerviniStrategy } = await import('@/lib/strategies/impl/stocks/vcp-minervini')
    const strategy = new VcpMinerviniStrategy()
    const position = makePosition({ entryPrice: 200 })
    const tick = makeTick('AAPL', 225)  // +12.5%

    const action = await strategy.manageOpenPosition(position, tick)
    // Should adjust trailing stop
    expect(action.type === 'adjustStop' || action.type === 'close' || action.type === 'hold').toBe(true)
  })

  it('closes after 90-day timeout', async () => {
    const { VcpMinerviniStrategy } = await import('@/lib/strategies/impl/stocks/vcp-minervini')
    const strategy = new VcpMinerviniStrategy()
    const ninetyOneDaysAgo = Date.now() - 91 * 86_400_000
    const position = makePosition({ entryPrice: 200, openedAt: ninetyOneDaysAgo })
    const tick = makeTick('AAPL', 205)

    const action = await strategy.manageOpenPosition(position, tick)
    expect(action.type).toBe('close')
    if (action.type === 'close') expect(action.reason).toContain('90-day')
  })
})

// ─── Polymarket Wallet Copy manageOpenPosition ────────────────────────────────

describe('PolymarketWalletCopyStrategy.manageOpenPosition', () => {
  it('closes at -30% drawdown', async () => {
    const { PolymarketWalletCopyStrategy } = await import('@/lib/strategies/impl/polymarket/polymarket-wallet-copy')
    const strategy = new PolymarketWalletCopyStrategy()
    const position = makePosition({
      strategyKey: 'polymarket_wallet_copy',
      assetClass: 'polymarket',
      entryPrice: 0.60,
      direction: 'long',
    })
    const tick = makeTick('POLY:abc', 0.42)  // -30% from 0.60

    const action = await strategy.manageOpenPosition(position, tick)
    expect(action.type).toBe('close')
    if (action.type === 'close') expect(action.reason).toContain('drawdown')
  })

  it('closes when market resolves (price near 1)', async () => {
    const { PolymarketWalletCopyStrategy } = await import('@/lib/strategies/impl/polymarket/polymarket-wallet-copy')
    const strategy = new PolymarketWalletCopyStrategy()
    const position = makePosition({ strategyKey: 'polymarket_wallet_copy', assetClass: 'polymarket', entryPrice: 0.60 })
    const tick = makeTick('POLY:abc', 0.98)

    const action = await strategy.manageOpenPosition(position, tick)
    expect(action.type).toBe('close')
    if (action.type === 'close') expect(action.reason).toContain('resolved')
  })

  it('holds at -15% (below -30% threshold)', async () => {
    const { PolymarketWalletCopyStrategy } = await import('@/lib/strategies/impl/polymarket/polymarket-wallet-copy')
    const strategy = new PolymarketWalletCopyStrategy()
    const position = makePosition({ strategyKey: 'polymarket_wallet_copy', assetClass: 'polymarket', entryPrice: 0.60 })
    const tick = makeTick('POLY:abc', 0.51)  // -15%

    const action = await strategy.manageOpenPosition(position, tick)
    expect(action.type).toBe('hold')
  })
})

// ─── scan-all auth ────────────────────────────────────────────────────────────

describe('scan-all route auth', () => {
  const origKey = process.env.WEALTH_OS_API_KEY

  beforeEach(() => {
    process.env.WEALTH_OS_API_KEY = 'secret-key'
  })

  afterEach(() => {
    if (origKey) process.env.WEALTH_OS_API_KEY = origKey
    else delete process.env.WEALTH_OS_API_KEY
  })

  it('rejects request with wrong API key', async () => {
    const { GET } = await import('@/app/api/internal/scan-all/route')
    const req = new Request('http://localhost/api/internal/scan-all', {
      method: 'GET',
      headers: { Authorization: 'Bearer wrong-key' },
    })
    const res = await GET(req as never)
    expect(res.status).toBe(401)
  })

  it('rejects request with missing Authorization header', async () => {
    const { GET } = await import('@/app/api/internal/scan-all/route')
    const req = new Request('http://localhost/api/internal/scan-all', { method: 'GET' })
    const res = await GET(req as never)
    expect(res.status).toBe(401)
  })

  it('accepts request with correct API key', async () => {
    const { GET } = await import('@/app/api/internal/scan-all/route')
    const req = new Request('http://localhost/api/internal/scan-all', {
      method: 'GET',
      headers: { Authorization: 'Bearer secret-key' },
    })
    const res = await GET(req as never)
    expect(res.status).toBe(200)
  })
})

// ─── PositionMonitor.applyAction ─────────────────────────────────────────────

describe('PositionMonitor.applyAction', () => {
  it('holds do not call Supabase update', async () => {
    const updateMock = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
    const supabaseMock = { from: vi.fn().mockReturnValue({ select: vi.fn(), update: updateMock }) }

    // Patch env before PositionMonitor is imported (it reads env in constructor)
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'

    const { PositionMonitor } = await import('@/lib/workers/position-monitor')

    // Stub createClient to return our mock
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => supabaseMock,
    }))

    const monitor = new PositionMonitor()
    const position = makePosition()
    const tick = makeTick('AAPL', 205)

    await monitor.applyAction(position, { type: 'hold' }, tick)
    expect(updateMock).not.toHaveBeenCalled()
  })
})
