/**
 * Shared historical market-return series. The 20y S&P 500 monthly return
 * series the planning Monte Carlo block-bootstraps from, plus any other
 * symbol's monthly series (Phase 3: the bond fund, for the tier-mix bad
 * year). Cached for a day per symbol; returns [] on failure (callers must
 * handle the honest "can't estimate right now" case).
 */

const _cache = new Map<string, { returns: number[]; at: number }>()

/** Monthly simple returns for a Yahoo symbol over the last 20 years. */
export async function fetchMonthlyReturns(symbol: string): Promise<number[]> {
  const hit = _cache.get(symbol)
  if (hit && Date.now() - hit.at < 86_400_000) return hit.returns
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1mo&range=20y`,
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
    if (returns.length >= 60) _cache.set(symbol, { returns, at: Date.now() })
    return returns
  } catch {
    return []
  }
}

export async function fetchSpxMonthlyReturns(): Promise<number[]> {
  return fetchMonthlyReturns('^GSPC')
}
