/**
 * Live yield data for the emergency-fund card (R3).
 *
 * The brief is explicit: yield figures must be LIVE, never hardcoded — the
 * source list's "4–5% HYSA / 5%+ T-bills" were stale 2024 rates. Sources:
 *   - Treasury daily bill rates (fiscaldata.treasury.gov, no key)
 *   - FDIC national deposit rates (api.fdic.gov, no key)
 * Cached in-process for 12h. Returns null fields on failure — the card shows
 * "rates unavailable" rather than a stale number.
 */

export interface YieldSnapshot {
  tbill3moPct: number | null
  savingsNationalAvgPct: number | null
  fetchedAt: string
}

let _cache: YieldSnapshot | null = null
const CACHE_MS = 12 * 60 * 60 * 1000

async function fetchTbill3mo(): Promise<number | null> {
  try {
    const url =
      'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates' +
      '?filter=security_desc:eq:Treasury%20Bills&sort=-record_date&page[size]=1'
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return null
    const data = await res.json() as { data?: Array<{ avg_interest_rate_amt?: string }> }
    const rate = parseFloat(data.data?.[0]?.avg_interest_rate_amt ?? '')
    return Number.isFinite(rate) && rate > 0 ? rate : null
  } catch {
    return null
  }
}

async function fetchFdicSavingsRate(): Promise<number | null> {
  try {
    // FDIC national rates on deposit products (savings, non-jumbo).
    const url =
      'https://api.fdic.gov/api/national-rates?filters=product_type:SAV&sort_by=week_ending&sort_order=DESC&limit=1&format=json'
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return null
    const data = await res.json() as { data?: Array<{ national_rate?: number | string }> }
    const rate = parseFloat(String(data.data?.[0]?.national_rate ?? ''))
    return Number.isFinite(rate) && rate > 0 ? rate : null
  } catch {
    return null
  }
}

export async function fetchCurrentYields(): Promise<YieldSnapshot> {
  if (_cache && Date.now() - new Date(_cache.fetchedAt).getTime() < CACHE_MS) {
    return _cache
  }
  const [tbill, savings] = await Promise.all([fetchTbill3mo(), fetchFdicSavingsRate()])
  _cache = {
    tbill3moPct: tbill,
    savingsNationalAvgPct: savings,
    fetchedAt: new Date().toISOString(),
  }
  return _cache
}
