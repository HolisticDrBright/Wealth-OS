/**
 * Camofox integration tests.
 *
 * Tests CamofoxClient gating, graceful degradation, and the
 * sync-quiver-quant fallback path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CamofoxClient } from '@/lib/integrations/camofox/CamofoxClient'

// ─── Mock FeatureFlagService ───────────────────────────────────────────────────

const { mockCanSpend, mockLogUsage } = vi.hoisted(() => {
  const mockCanSpend = vi.fn().mockResolvedValue({ allowed: true })
  const mockLogUsage = vi.fn().mockResolvedValue(undefined)
  return { mockCanSpend, mockLogUsage }
})

vi.mock('@/lib/feature-flags/FeatureFlagService', () => ({
  FeatureFlagService: class {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    canSpend(...args: any[]) { return mockCanSpend(...args) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logUsage(...args: any[]) { return mockLogUsage(...args) }
  },
}))

function makeSupabase(): SupabaseClient {
  return {} as SupabaseClient
}

describe('CamofoxClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    mockCanSpend.mockResolvedValue({ allowed: true })
  })

  // ── Test 1: ping() works without auth ────────────────────────────────────────
  it('ping() returns ok=true when health endpoint responds 200', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response)
    const result = await CamofoxClient.ping()
    expect(result.ok).toBe(true)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  // ── Test 2: ping() returns ok=false when server unreachable ──────────────────
  it('ping() returns ok=false when Camofox container is down', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const result = await CamofoxClient.ping()
    expect(result.ok).toBe(false)
  })

  // ── Test 3: navigate() returns skipped when flag is disabled ─────────────────
  it('navigate() returns skipped when camofox_scraping feature is disabled', async () => {
    mockCanSpend.mockResolvedValueOnce({ allowed: false, reason: 'disabled' })

    const client = new CamofoxClient(makeSupabase(), 'user-123')
    const res = await client.navigate('https://www.capitoltrades.com')

    expect(res.skipped).toBe(true)
    expect(res.reason).toContain('disabled')
    expect(fetch).not.toHaveBeenCalled()
  })

  // ── Test 4: getPageText() strips HTML and returns clean text ──────────────────
  it('getPageText() returns clean text with word count when server responds', async () => {
    const mockHtml = '<html><head><style>body{}</style></head><body><h1>Congress Trade: BUY AAPL</h1><p>Amount: $50,000</p><script>alert(1)</script></body></html>'
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ url: 'https://example.com', title: 'Test', status: 200, html: mockHtml }),
    } as Response)

    const client = new CamofoxClient(makeSupabase(), 'user-456')
    const res = await client.getPageText('https://www.capitoltrades.com')

    expect(res.skipped).toBe(false)
    if (!res.skipped) {
      expect(res.result.text).toContain('Congress Trade')
      expect(res.result.text).not.toContain('<html>')
      expect(res.result.text).not.toContain('alert(1)')
      expect(res.result.wordCount).toBeGreaterThan(0)
    }
  })

  // ── Test 5: Returns skipped with reason on HTTP error ────────────────────────
  it('returns skipped with HTTP error reason when Camofox returns 503', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
    } as Response)

    const client = new CamofoxClient(makeSupabase(), 'user-789')
    const res = await client.screenshot('https://example.com')

    expect(res.skipped).toBe(true)
    expect(res.reason).toContain('503')
  })
})
