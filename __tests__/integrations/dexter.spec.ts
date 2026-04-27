/**
 * DexterClient — 3 unit tests
 *
 * Tests:
 *  1. fetchSecFiling returns skipped when feature flag denied
 *  2. fetchEarningsTranscript returns data when flag allowed
 *  3. fetchAnalystReports degrades gracefully on network error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const { mockCanSpend, mockLogUsage } = vi.hoisted(() => {
  const mockCanSpend = vi.fn().mockResolvedValue({ allowed: true })
  const mockLogUsage = vi.fn().mockResolvedValue(undefined)
  return { mockCanSpend, mockLogUsage }
})

vi.mock('@/lib/feature-flags/FeatureFlagService', () => ({
  FeatureFlagService: class {
    canSpend(...args: unknown[]) { return mockCanSpend(...args) }
    logUsage(...args: unknown[]) { return mockLogUsage(...args) }
  },
}))

function makeSupabase(): SupabaseClient {
  return {} as unknown as SupabaseClient
}

describe('DexterClient', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    mockCanSpend.mockResolvedValue({ allowed: true })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('fetchSecFiling returns skipped when feature flag denied', async () => {
    mockCanSpend.mockResolvedValueOnce({ allowed: false, reason: 'budget exhausted' })

    const { DexterClient } = await import('@/lib/integrations/dexter/DexterClient')
    const client = new DexterClient(makeSupabase(), 'user-1')
    const result = await client.fetchSecFiling('AAPL', '10-K')

    expect(result.skipped).toBe(true)
    expect(result.result).toBeNull()
    expect(result.reason).toContain('budget')
  })

  it('fetchEarningsTranscript returns transcript data when sidecar responds', async () => {
    const transcript = {
      ticker: 'AAPL', quarter: 'Q1 2026', reportedAt: '2026-02-01',
      epsSurprise: 0.12, revenueSurprise: 450, managementTone: 'positive',
      guidanceDirection: 'raised', keyQuotes: ['Record revenue quarter'],
      summary: 'Strong beat on EPS and revenue.',
    }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(transcript),
    }))

    const { DexterClient } = await import('@/lib/integrations/dexter/DexterClient')
    const client = new DexterClient(makeSupabase(), 'user-1')
    const result = await client.fetchEarningsTranscript('AAPL', 'Q1 2026')

    expect(result.skipped).toBe(false)
    expect(result.result?.managementTone).toBe('positive')
    expect(result.result?.epsSurprise).toBe(0.12)
    expect(mockLogUsage).toHaveBeenCalledOnce()
  })

  it('fetchAnalystReports returns empty array and skipped=true on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const { DexterClient } = await import('@/lib/integrations/dexter/DexterClient')
    const client = new DexterClient(makeSupabase(), 'user-1')
    const result = await client.fetchAnalystReports('TSLA')

    expect(result.skipped).toBe(true)
    expect(result.result).toEqual([])
    expect(result.reason).toContain('unreachable')
  })
})
