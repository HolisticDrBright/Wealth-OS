import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const MOCK_SYMBOL: Record<string, unknown> = {
  count: 20,
  results: [
    { title: 'BTC rockets to new ATH', currencies: [{ code: 'BTC' }], votes: { positive: 8, negative: 1, important: 0, liked: 0, disliked: 0, lol: 0, toxic: 0, saved: 0, comments: 2 } },
    { title: 'Bear market incoming?',  currencies: [{ code: 'BTC' }], votes: { positive: 1, negative: 9, important: 0, liked: 0, disliked: 0, lol: 0, toxic: 0, saved: 0, comments: 1 } },
    { title: 'BTC sideways action',    currencies: [{ code: 'BTC' }], votes: { positive: 4, negative: 4, important: 0, liked: 0, disliked: 0, lol: 0, toxic: 0, saved: 0, comments: 0 } },
  ],
}
const MOCK_GLOBAL: Record<string, unknown> = { count: 200, results: [] }

function mockFetch(responses: Record<string, unknown>[]) {
  let callIndex = 0
  return vi.spyOn(global, 'fetch').mockImplementation(() => {
    const body = responses[callIndex++ % responses.length]
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
    } as Response)
  })
}

describe('narrativeHeatScore', () => {
  beforeEach(() => {
    vi.stubEnv('CRYPTOPANIC_API_KEY', 'test-key-123')
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('score is in [0, 100] and polarity is in [-1, 1]', async () => {
    mockFetch([MOCK_SYMBOL, MOCK_GLOBAL])
    const { narrativeHeatScore } = await import('../mcp-config')

    const result = await narrativeHeatScore('BTC', '24h')

    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.polarity).toBeGreaterThanOrEqual(-1)
    expect(result.polarity).toBeLessThanOrEqual(1)
    expect(result.posts).toBe(20)
  })

  it('polarity is (bullish - bearish) / total', async () => {
    // MOCK_SYMBOL has 3 posts: 1 bullish (8>1), 1 bearish (1<9), 1 neutral (4=4)
    // polarity = (1 - 1) / 3 = 0
    mockFetch([MOCK_SYMBOL, MOCK_GLOBAL])
    const { narrativeHeatScore } = await import('../mcp-config')

    const result = await narrativeHeatScore('BTC', '24h')
    expect(result.polarity).toBeCloseTo(0, 5)
  })

  it('60s cache hit does not re-fetch', async () => {
    const spy = mockFetch([MOCK_SYMBOL, MOCK_GLOBAL])
    const { narrativeHeatScore, clearCache } = await import('../mcp-config')
    clearCache()

    await narrativeHeatScore('ETH', '24h')
    const callsAfterFirst = spy.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThan(0)

    // Second call within TTL — cache hit, no additional fetch
    await narrativeHeatScore('ETH', '24h')
    expect(spy.mock.calls.length).toBe(callsAfterFirst)
  })

  it('returns zeros when CRYPTOPANIC_API_KEY is missing', async () => {
    vi.unstubAllEnvs()
    const { narrativeHeatScore } = await import('../mcp-config')

    const result = await narrativeHeatScore('BTC', '24h')
    expect(result.score).toBe(0)
    expect(result.posts).toBe(0)
    expect(result.polarity).toBe(0)
  })

  it('returns zeros when the API call fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, json: () => Promise.resolve({}) } as Response)
    const { narrativeHeatScore, clearCache } = await import('../mcp-config')
    clearCache()

    const result = await narrativeHeatScore('BTC', '24h')
    expect(result.score).toBe(0)
    expect(result.posts).toBe(0)
  })
})
