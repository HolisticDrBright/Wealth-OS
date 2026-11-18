/**
 * Shared historical market-return series (Phase 3) — the same 20y S&P 500
 * monthly return series the planning Monte Carlo block-bootstraps from, moved
 * out of lib/actions/planning.ts so goal projection and the simple dashboard
 * use ONE source. Cached for a day; returns [] on failure (callers must
 * handle the honest "can't estimate right now" case).
 */

let _monthlyCache: { returns: number[]; at: number } | null = null

export async function fetchSpxMonthlyReturns(): Promise<number[]> {
  if (_monthlyCache && Date.now() - _monthlyCache.at < 86_400_000) return _monthlyCache.returns
  try {
    const res = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1mo&range=20y',
      { signal: AbortSignal.timeout(8_000) }
    )
    if (!res.ok) return []
    const data: unknown = await res.json()
    const result = ((data as Record<string, unknown>)?.chart as Record<string, unknown>)?.result as unknown[]
    const quote = (((result?.[0] as Record<string, unknown>)?.indicators as Record<string, unknown>)
      ?.quote as unknown[])?.[0] as Record<string, unknown>
    const closes = (quote?.close as Array<number | null> | undefined ?? [])
      .filter((c): c is number => typeof c === 'number' && c > 0)
    const returns: number[] = []
    for (let i = 1; i < closes.length; i++) returns.push(closes[i] / closes[i - 1] - 1)
    if (returns.length >= 60) _monthlyCache = { returns, at: Date.now() }
    return returns
  } catch {
    return []
  }
}
