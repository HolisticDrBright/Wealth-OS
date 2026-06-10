/**
 * Cross-Asset Regime Detection (T4.2)
 *
 * Classifies the market into one of four regimes by reading:
 *   - VIX   (fear index, ^VIX via Yahoo Finance)
 *   - HY OAS (credit stress, FRED series BAMLH0A0HYM2 — option-adjusted
 *     spread, reported by FRED in PERCENT and converted here to bps).
 *     NOTE: an earlier version compared FRED's percent value (e.g. 4.5)
 *     against bps thresholds (e.g. 800), so the credit leg could never
 *     trigger. Fixed by converting to bps at the fetch boundary.
 *
 * Regime rules (applied in priority order, thresholds in bps for OAS):
 *   CRISIS:   VIX ≥ crisisVix OR HY OAS ≥ 800
 *   RISK_OFF: VIX ≥ riskOffVix OR HY OAS ≥ 600
 *   RISK_ON:  VIX < 20 AND HY OAS < 400
 *   NEUTRAL:  everything else
 *
 * Adaptive thresholds (tighten-only): the VIX risk-off/crisis levels adapt to
 * the trailing year's distribution — in a structurally elevated-vol year the
 * 80th/95th percentiles pull the triggers BELOW the fixed 30/40 so caution
 * arrives earlier. The fixed levels are hard CEILINGS and the floors prevent
 * a freakishly calm year from crying wolf: adaptation can only make the
 * system more cautious, never less.
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

export interface RegimeThresholds {
  /** VIX level at/above which RISK_OFF triggers. ≤ 30 always. */
  riskOffVix: number
  /** VIX level at/above which CRISIS triggers. ≤ 40 always. */
  crisisVix: number
  /** True when trailing-year percentiles tightened the fixed levels. */
  adaptive: boolean
}

export interface RegimeReading {
  regime: CrossAssetRegime
  vix: number | null
  /** HY option-adjusted spread in BASIS POINTS (FRED percent × 100). */
  hyOas: number | null
  resolvedAt: number
  thresholds?: RegimeThresholds
}

export const FIXED_THRESHOLDS: RegimeThresholds = {
  riskOffVix: 30,
  crisisVix: 40,
  adaptive: false,
}

// Floors for adaptive tightening — adaptation may pull triggers down to these
// levels but no further, so a low-vol year can't make VIX 15 read as RISK_OFF.
const RISK_OFF_FLOOR = 24
const CRISIS_FLOOR = 32

// ─── In-process cache ────────────────────────────────────────────────────────

let _cache: RegimeReading | null = null
const CACHE_MS = 60 * 60 * 1_000   // 1 hour

// ─── Pure logic (exported for tests) ─────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[idx]
}

/**
 * Derive tighten-only thresholds from trailing VIX closes.
 * effective = clamp(percentile, floor, fixed ceiling) — never above fixed.
 */
export function computeAdaptiveThresholds(vixCloses: number[]): RegimeThresholds {
  const valid = vixCloses.filter(v => Number.isFinite(v) && v > 0)
  if (valid.length < 60) return FIXED_THRESHOLDS  // need a meaningful sample

  const sorted = [...valid].sort((a, b) => a - b)
  const p80 = percentile(sorted, 0.80)
  const p95 = percentile(sorted, 0.95)

  const riskOffVix = Math.min(FIXED_THRESHOLDS.riskOffVix, Math.max(RISK_OFF_FLOOR, p80))
  const crisisVix  = Math.min(FIXED_THRESHOLDS.crisisVix,  Math.max(CRISIS_FLOOR, p95))

  return {
    riskOffVix,
    crisisVix,
    adaptive: riskOffVix < FIXED_THRESHOLDS.riskOffVix || crisisVix < FIXED_THRESHOLDS.crisisVix,
  }
}

/** Classify the regime from current readings. hyOas in basis points. */
export function classifyRegime(
  vix: number | null,
  hyOasBps: number | null,
  thresholds: RegimeThresholds = FIXED_THRESHOLDS,
): CrossAssetRegime {
  if ((vix !== null && vix >= thresholds.crisisVix) || (hyOasBps !== null && hyOasBps >= 800)) {
    return CrossAssetRegime.CRISIS
  }
  if ((vix !== null && vix >= thresholds.riskOffVix) || (hyOasBps !== null && hyOasBps >= 600)) {
    return CrossAssetRegime.RISK_OFF
  }
  if ((vix !== null && vix < 20) && (hyOasBps === null || hyOasBps < 400)) {
    return CrossAssetRegime.RISK_ON
  }
  return CrossAssetRegime.NEUTRAL
}

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

/** Trailing daily closes for adaptive thresholds. Empty array on failure. */
async function fetchYahooCloses(symbol: string, range = '1y'): Promise<number[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return []
    const data: unknown = await res.json()
    const result = ((data as Record<string, unknown>)?.chart as Record<string, unknown>)
      ?.result as unknown[]
    const indicators = (result?.[0] as Record<string, unknown>)?.indicators as Record<string, unknown>
    const quote = (indicators?.quote as unknown[])?.[0] as Record<string, unknown>
    const closes = quote?.close
    if (!Array.isArray(closes)) return []
    return closes.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  } catch {
    return []
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

  const [vix, hyOasPercent, vixHistory] = await Promise.all([
    fetchYahooLast('^VIX'),
    fetchFredLast('BAMLH0A0HYM2'),     // HY OAS, FRED reports percent
    fetchYahooCloses('^VIX', '1y'),
  ])

  // FRED OAS arrives as percent (e.g. 4.5) — convert to bps for the rules.
  const hyOas = hyOasPercent !== null ? hyOasPercent * 100 : null

  const thresholds = computeAdaptiveThresholds(vixHistory)
  const regime = classifyRegime(vix, hyOas, thresholds)

  _cache = { regime, vix, hyOas, resolvedAt: Date.now(), thresholds }
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
