/**
 * CrucixClient — 3 unit tests
 *
 * Tests:
 *  1. getWhaleMovements returns skipped when feature flag denied
 *  2. getWhaleSignal computes correct dominantDirection from movements
 *  3. getWhaleSignal returns neutral when API unreachable
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const { mockCanSpend } = vi.hoisted(() => {
  const mockCanSpend = vi.fn().mockResolvedValue({ allowed: true })
  return { mockCanSpend }
})

vi.mock('@/lib/feature-flags/FeatureFlagService', () => ({
  FeatureFlagService: class {
    canSpend(...args: unknown[]) { return mockCanSpend(...args) }
    logUsage() { return Promise.resolve(undefined) }
  },
}))

function makeSupabase(): SupabaseClient {
  return {} as unknown as SupabaseClient
}

describe('CrucixClient', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    mockCanSpend.mockResolvedValue({ allowed: true })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('getWhaleMovements returns skipped when feature flag denied', async () => {
    mockCanSpend.mockResolvedValueOnce({ allowed: false, reason: 'disabled' })

    const { CrucixClient } = await import('@/lib/integrations/crucix/CrucixClient')
    const client = new CrucixClient(makeSupabase(), 'user-1')
    const result = await client.getWhaleMovements('BTC')

    expect(result.skipped).toBe(true)
    expect(result.result).toEqual([])
  })

  it('getWhaleSignal computes inflow dominance from mock movements', async () => {
    const movements = [
      { direction: 'inflow', amountUsd: 500_000, walletAddress: '0xabc', chain: 'polygon', token: 'WBTC', symbol: 'BTC', txHash: '0x1', blockNumber: 1, timestamp: new Date().toISOString(), label: null, isKnownActor: false },
      { direction: 'inflow', amountUsd: 200_000, walletAddress: '0xdef', chain: 'polygon', token: 'WBTC', symbol: 'BTC', txHash: '0x2', blockNumber: 2, timestamp: new Date().toISOString(), label: null, isKnownActor: false },
      { direction: 'outflow', amountUsd: 50_000, walletAddress: '0xghi', chain: 'polygon', token: 'WBTC', symbol: 'BTC', txHash: '0x3', blockNumber: 3, timestamp: new Date().toISOString(), label: null, isKnownActor: false },
    ]

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(movements),
    }))

    const { CrucixClient } = await import('@/lib/integrations/crucix/CrucixClient')
    const client = new CrucixClient(makeSupabase(), 'user-1')
    const result = await client.getWhaleSignal('BTC')

    expect(result.skipped).toBe(false)
    expect(result.result?.dominantDirection).toBe('inflow')
    expect(result.result?.netFlowUsd).toBeGreaterThan(0)
    expect(result.result?.inflowCount).toBe(2)
    expect(result.result?.outflowCount).toBe(1)
  })

  it('getWhaleSignal returns null result when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))

    const { CrucixClient } = await import('@/lib/integrations/crucix/CrucixClient')
    const client = new CrucixClient(makeSupabase(), 'user-1')
    const result = await client.getWhaleSignal('ETH')

    expect(result.skipped).toBe(true)
    expect(result.result).toBeNull()
  })
})
