/**
 * Cross-Asset Regime Detection (T4.2)
 *
 * Classifies the market into one of four regimes by reading:
 *   - VIX  (fear index, ^VIX via Yahoo Finance)
 *   - BTC  (risk appetite proxy, BTC-USD via Yahoo Finance)
 *   - HY OAS (credit stress, FRED series BAMLH0A0HYM2EY)
 *
 * Regime rules (applied in priority order):
 *   CRISIS:   VIX ≥ 40 OR HY OAS ≥ 800 bps
 *   RISK_OFF: VIX ≥ 30 OR HY OAS ≥ 600 bps
 *   RISK_ON:  VIX < 20 AND HY OAS < 400 bps
 *   NEUTRAL:  everything else
 *
 * Effect on pipeline (wired in BasePipelineStrategy.detectWithConfluence):
 *   RISK_OFF:  directional strategies get 50% size haircut
 *   CRISIS:    return [] for all strategies except 'tail_risk_hedging'
 *
 * In-process cache: 1 hour (avoid hammering public APIs on every scan).
 */

export enum CrossAssetRegime {
  RISK_ON  = 'RISK_ON',
  NEUTRAL  = 'NEUTRAL',
  RISK_OFF = 'RISK_OFF',
  CRISIS   = 'CRISIS',
}

export interface RegimeReading {
  regime: CrossAssetRegime
  vix: number | null
  hyOas: number | null
  resolvedAt: number
}

// ─── In-process cache ────────────────────────────────────────────────────────

let _cache: RegimeReading | null = null
const CACHE_MS = 60 * 60 * 1_000   // 1 hour

// ─── Public API helpers ───────────────────────────────────────────────────────

async function fetchYahooLast(symbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return null
    const data: unknown = await res.json()
    const result = ((data as Record<string, unknown>)?.chart as Record<string, unknown>)
      ?.result as unknown[]
    const meta = (result?.[0] as Record<string, unknown>)?.meta as Record<string, unknown>
    const price = meta?.regularMarketPrice ?? meta?.previousClose
    return typeof price === 'number' ? price : null
  } catch {
    return null
  }
}

async function fetchFredLast(series: string): Promise<number | null> {
  const apiKey = process.env.FRED_API_KEY
  if (!apiKey) return null
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${apiKey}&file_type=json&limit=1&sort_order=desc`
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return null
    const data: unknown = await res.json()
    const obs = ((data as Record<string, unknown>)?.observations as unknown[])
    const val = (obs?.[0] as Record<string, unknown>)?.value
    const n = parseFloat(String(val ?? ''))
    return isNaN(n) ? null : n
  } catch {
    return null
  }
}

// ─── Regime detection ─────────────────────────────────────────────────────────

export async function detectRegime(): Promise<RegimeReading> {
  if (_cache && Date.now() - _cache.resolvedAt < CACHE_MS) {
    return _cache
  }

  const [vix, hyOas] = await Promise.all([
    fetchYahooLast('^VIX'),
    fetchFredLast('BAMLH0A0HYM2EY'),
  ])

  let regime: CrossAssetRegime

  if ((vix !== null && vix >= 40) || (hyOas !== null && hyOas >= 800)) {
    regime = CrossAssetRegime.CRISIS
  } else if ((vix !== null && vix >= 30) || (hyOas !== null && hyOas >= 600)) {
    regime = CrossAssetRegime.RISK_OFF
  } else if (
    (vix !== null && vix < 20) &&
    (hyOas === null || hyOas < 400)
  ) {
    regime = CrossAssetRegime.RISK_ON
  } else {
    regime = CrossAssetRegime.NEUTRAL
  }

  _cache = { regime, vix, hyOas, resolvedAt: Date.now() }
  return _cache
}

/** Returns the cached regime synchronously if available; else NEUTRAL. */
export function getCachedRegime(): CrossAssetRegime {
  return _cache?.regime ?? CrossAssetRegime.NEUTRAL
}

/** For testing — override the cache. */
export function _setRegimeForTest(r: RegimeReading): void {
  _cache = r
}
