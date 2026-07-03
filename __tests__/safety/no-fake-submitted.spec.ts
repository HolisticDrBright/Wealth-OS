/**
 * No fake 'submitted' states — an adapter or strategy may only report
 * 'submitted' when a real order was actually sent somewhere. Placeholder /
 * pending-integration paths must return 'skipped' so paper-trading metrics
 * and order reconciliation never count phantom orders.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { EToroAdapter, PolymarketAdapter } from '@/lib/broker-adapters/adapters'
import { CexLatencyArbStrategy } from '@/lib/strategies/impl/crypto/cex-latency-arb'
import type { Opportunity, PositionSize } from '@/lib/strategies/pipeline-types'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('placeholder adapters never report submitted', () => {
  it('EToroAdapter (partner API pending) returns skipped even when configured', async () => {
    vi.stubEnv('ETORO_API_KEY', 'fake')
    vi.stubEnv('ETORO_ACCOUNT_ID', 'fake')
    const result = await new EToroAdapter().execute({
      symbol: 'AAPL', asset_class: 'stock', side: 'buy', notional_usd: 100,
    })
    expect(result.status).toBe('skipped')
    expect(result.reason).toContain('no order placed')
  })

  it('PolymarketAdapter.placeBracketOrder (CLOB pending) returns skipped even when configured', async () => {
    vi.stubEnv('POLYMARKET_PRIVATE_KEY', 'fake')
    const result = await new PolymarketAdapter().placeBracketOrder({
      symbol: 'POLY:0xabc', asset_class: 'polymarket', side: 'buy',
      notional_usd: 100, take_profit_price: 0.75,
    })
    expect(result.status).toBe('skipped')
    expect(result.reason).toContain('no take-profit order placed')
  })
})

describe('cex-latency-arb execute (no real leg placement yet)', () => {
  it('returns skipped, not submitted', async () => {
    const strat = new CexLatencyArbStrategy()
    // Mechanics under test is the return status — bypass the gates.
    const bypass = strat as unknown as {
      checkKillSwitch: () => Promise<null>
      checkLiveGate: () => Promise<null>
    }
    bypass.checkKillSwitch = async () => null
    bypass.checkLiveGate = async () => null

    const insert = vi.fn(async () => ({ error: null }))
    const supabase = { from: vi.fn(() => ({ insert })) } as never

    const opp = {
      id: 'opp-1', strategyKey: 'cex_latency_arb', symbol: 'BTC',
      assetClass: 'crypto', direction: 'long', expectedReturn: 0.001,
      strength: 0.9,
      metadata: {
        longVenue: 'coinbase', shortVenue: 'kraken', symbol: 'BTC',
        longAsk: 100_000, shortBid: 100_050, netBpsAfterFees: 5,
        hardExitAt: Date.now() - 1_000, // already past — no timer scheduled
      },
    } as unknown as Opportunity
    const size: PositionSize = { fraction: 0.002, notionalUsd: 200, rationale: 'test' }

    const result = await strat.execute(opp, size, 'user-1', supabase)
    expect(result.status).toBe('skipped')
    expect(result.error).toContain('no orders placed')
  })
})
