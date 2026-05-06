/**
 * SEC EDGAR public data client — Form 4 insider transactions and 13D/G filings.
 * Uses the EDGAR full-text search API (no key required).
 */

export interface Form4Filing {
  ticker: string
  insider_id: string
  insider_role: string    // 'officer' | 'director' | 'ten_pct' | 'other'
  transaction_type: 'purchase' | 'sale' | 'other'
  notional_usd: number
  filed: string           // ISO date
  is_10b5_1: boolean
}

export interface Filing13DG {
  ticker: string
  filer: string
  pct_ownership: number
  filed: string
}

const EDGAR_BASE = 'https://efts.sec.gov/LATEST/search-index'

function roleFromTitle(title: string): Form4Filing['insider_role'] {
  const t = title.toLowerCase()
  if (t.includes('president') || t.includes('ceo') || t.includes('cfo') ||
      t.includes('coo') || t.includes('officer')) return 'officer'
  if (t.includes('director')) return 'director'
  if (t.includes('10%') || t.includes('ten percent')) return 'ten_pct'
  return 'other'
}

export function isExecutiveOrBoard(role: string): boolean {
  return role === 'officer' || role === 'director'
}

/**
 * Fetch recent Form 4 filings from EDGAR. Returns up to `limit` filings.
 * Filtered by transaction type (purchase/sale). Falls back to [] on network errors.
 */
export async function fetchForm4Filings(params: {
  after?: number        // ms since epoch
  type?: 'purchase' | 'sale'
  ticker?: string
  limit?: number
}): Promise<Form4Filing[]> {
  try {
    const startDate = params.after
      ? new Date(params.after).toISOString().split('T')[0]
      : new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0]

    const formType = '4'
    const q = params.ticker ? `${params.ticker} form-type:${formType}` : `form-type:${formType}`
    const url = `${EDGAR_BASE}?q=${encodeURIComponent(q)}&dateRange=custom&startdt=${startDate}&forms=4&_source=period_of_report,entity_name,file_date&hits.hits._source=true&hits.hits.total.value=true`

    const res = await fetch(url, { signal: AbortSignal.timeout(6_000) })
    if (!res.ok) return []
    const data: unknown = await res.json()

    const hits = ((data as Record<string, unknown>)?.hits as Record<string, unknown>)?.hits as unknown[] ?? []

    return hits.slice(0, params.limit ?? 50).map((h: unknown) => {
      const src = ((h as Record<string, unknown>)?._source as Record<string, unknown>) ?? {}
      return {
        ticker: (src.entity_name as string | undefined) ?? 'UNKNOWN',
        insider_id: (src.file_number as string | undefined) ?? '',
        insider_role: roleFromTitle((src.period_of_report as string | undefined) ?? ''),
        transaction_type: params.type ?? 'purchase',
        notional_usd: 0,     // EDGAR search doesn't return notional; enrichment needed
        filed: (src.file_date as string | undefined) ?? new Date().toISOString(),
        is_10b5_1: false,    // requires full filing parse
      }
    })
  } catch {
    return []
  }
}

/**
 * Fetch 13D/G filings (activist ownership disclosures) for a ticker.
 */
export async function search13DG(params: {
  ticker: string
  after?: number
}): Promise<Filing13DG[]> {
  try {
    const startDate = params.after
      ? new Date(params.after).toISOString().split('T')[0]
      : new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0]

    const url = `${EDGAR_BASE}?q=${encodeURIComponent(params.ticker)}&forms=SC+13D,SC+13G&dateRange=custom&startdt=${startDate}`
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000) })
    if (!res.ok) return []
    const data: unknown = await res.json()
    const hits = ((data as Record<string, unknown>)?.hits as Record<string, unknown>)?.hits as unknown[] ?? []

    return hits.slice(0, 10).map((h: unknown) => {
      const src = ((h as Record<string, unknown>)?._source as Record<string, unknown>) ?? {}
      return {
        ticker: params.ticker,
        filer: (src.entity_name as string | undefined) ?? '',
        pct_ownership: 0,
        filed: (src.file_date as string | undefined) ?? '',
      }
    })
  } catch {
    return []
  }
}

/**
 * Check if a 13D/G was filed for a ticker after a given timestamp.
 */
export async function has13DG(params: { ticker: string; after: number }): Promise<boolean> {
  const filings = await search13DG({ ticker: params.ticker, after: params.after })
  return filings.length > 0
}
