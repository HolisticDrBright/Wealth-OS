/**
 * FRED (Federal Reserve Economic Data) public API.
 * FRED_API_KEY is optional — falls back to a cached value or sensible default.
 */

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'

let _tbillCache: number | null = null
let _tbillCacheAt = 0
const CACHE_TTL_MS = 60 * 60 * 1_000   // 1h

/**
 * Fetch the current 4-week T-bill secondary market yield from FRED (DTB4WK).
 * Returns the yield as a decimal (e.g. 0.0525 = 5.25%).
 * Falls back to 0.05 (5%) if FRED is unavailable.
 */
export async function getTbill4WeekYield(): Promise<number> {
  if (_tbillCache !== null && Date.now() - _tbillCacheAt < CACHE_TTL_MS) {
    return _tbillCache
  }

  try {
    const apiKey = process.env.FRED_API_KEY ?? 'abcdefghijklmnopqrstuvwxyz123456'
    const url = `${FRED_BASE}?series_id=DTB4WK&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return _tbillCache ?? 0.05

    const data = await res.json() as { observations?: { value: string }[] }
    const raw = data.observations?.[0]?.value
    if (!raw || raw === '.') return _tbillCache ?? 0.05

    const yld = parseFloat(raw) / 100  // FRED returns percentage
    _tbillCache = yld
    _tbillCacheAt = Date.now()
    return yld
  } catch {
    return _tbillCache ?? 0.05
  }
}

/**
 * Fetch a generic FRED series' latest observation value.
 * Returns null when unavailable.
 */
export async function getFredSeries(seriesId: string): Promise<number | null> {
  try {
    const apiKey = process.env.FRED_API_KEY ?? 'abcdefghijklmnopqrstuvwxyz123456'
    const url = `${FRED_BASE}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return null
    const data = await res.json() as { observations?: { value: string }[] }
    const raw = data.observations?.[0]?.value
    if (!raw || raw === '.') return null
    return parseFloat(raw)
  } catch {
    return null
  }
}
