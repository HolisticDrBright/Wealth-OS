/**
 * Risk units (Phase 4) — budget the strategy slice by RISK, not dollars.
 *
 *   risk units = notional × annualized volatility
 *
 * Volatility is the instrument's realized volatility from daily closes when
 * at least VOL_MIN_OBSERVATIONS daily returns exist, otherwise a conservative
 * per-asset-class default (DEFAULT_ANNUAL_VOL). Binary prediction markets
 * use the stake as the maximum loss (risk units = stake). Options always use
 * the conservative default (an option can lose its whole premium).
 *
 * The Explore risk budget = Explore cap dollars × EXPLORE_RISK_REFERENCE_VOL;
 * one position may use at most MAX_POSITION_RISK_SHARE of it.
 *
 * Everything here feeds ADDITIONAL gates: callers take the smaller of the
 * existing allowed size and the risk-based one, so nothing can grow.
 */

import {
  VOL_MIN_OBSERVATIONS, VOL_LOOKBACK_DAYS, DEFAULT_ANNUAL_VOL, VOL_FLOOR_ANNUAL,
  EXPLORE_RISK_REFERENCE_VOL, MAX_POSITION_RISK_SHARE,
} from '@/lib/config/product-defaults'

export type RiskClass = 'stocks' | 'options' | 'crypto' | 'forex' | 'polymarket' | 'multi-asset'
export type VolSource = 'realized' | 'default' | 'binary'

export interface VolEstimate {
  /** Annualized volatility (1.0 for a binary: the stake is the max loss). */
  vol: number
  source: VolSource
  observations: number
}

/** Map any asset-class spelling used in the app onto the risk classes. */
export function toRiskClass(assetClass: string | null | undefined): RiskClass {
  const a = (assetClass ?? '').toLowerCase()
  if (a === 'stocks' || a === 'stock' || a === 'equity' || a === 'equities' || a === 'etf') return 'stocks'
  if (a === 'options' || a === 'option') return 'options'
  if (a === 'crypto' || a === 'cryptocurrency') return 'crypto'
  if (a === 'forex' || a === 'fx') return 'forex'
  if (a === 'polymarket' || a === 'prediction' || a === 'prediction_markets' || a === 'prediction_market') return 'polymarket'
  return 'multi-asset'
}

export function isBinary(assetClass: string | null | undefined): boolean {
  return toRiskClass(assetClass) === 'polymarket'
}

/** Return periods per year for annualizing daily returns (crypto trades every day). */
export function periodsPerYear(assetClass: string | null | undefined): number {
  return toRiskClass(assetClass) === 'crypto' ? 365 : 252
}

export function defaultVol(assetClass: string | null | undefined): number {
  const c = toRiskClass(assetClass)
  if (c === 'polymarket') return 1
  return DEFAULT_ANNUAL_VOL[c] ?? DEFAULT_ANNUAL_VOL['multi-asset'] ?? 0.4
}

/** Annualized standard deviation of simple daily returns from a close series. */
export function realizedVolFromCloses(closes: number[], assetClass: string | null | undefined): { vol: number | null; observations: number } {
  const clean = closes.filter(c => Number.isFinite(c) && c > 0)
  const rets: number[] = []
  for (let i = 1; i < clean.length; i++) rets.push(clean[i] / clean[i - 1] - 1)
  if (rets.length < 2) return { vol: null, observations: rets.length }
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1)
  return { vol: Math.sqrt(variance) * Math.sqrt(periodsPerYear(assetClass)), observations: rets.length }
}

/** PURE: pick the volatility the gates use, from whatever history is available. */
export function resolveVol(assetClass: string | null | undefined, closes: number[]): VolEstimate {
  const c = toRiskClass(assetClass)
  if (c === 'polymarket') return { vol: 1, source: 'binary', observations: 0 }
  if (c === 'options') return { vol: defaultVol(c), source: 'default', observations: 0 }
  const { vol, observations } = realizedVolFromCloses(closes, c)
  if (vol == null || observations < VOL_MIN_OBSERVATIONS) {
    return { vol: defaultVol(c), source: 'default', observations }
  }
  return { vol: Math.max(VOL_FLOOR_ANNUAL, vol), source: 'realized', observations }
}

export function riskUnits(notionalUsd: number, vol: number): number {
  return Math.abs(notionalUsd) * Math.max(0, vol)
}

/** Explore risk budget = Explore cap dollars × the reference volatility. */
export function exploreRiskBudget(exploreCapUsd: number): number {
  return Math.max(0, exploreCapUsd) * EXPLORE_RISK_REFERENCE_VOL
}

/**
 * The largest notional one position may have: its risk units may use at most
 * MAX_POSITION_RISK_SHARE of the Explore risk budget.
 */
export function positionRiskCeilingNotional(exploreCapUsd: number, vol: number): number {
  const maxRisk = MAX_POSITION_RISK_SHARE * exploreRiskBudget(exploreCapUsd)
  return vol > 0 ? maxRisk / vol : 0
}

/** Apply the ceiling: never returns more than `proposedUsd`. */
export function capToRiskCeiling(proposedUsd: number, exploreCapUsd: number, vol: number): { notionalUsd: number; capped: boolean; ceilingUsd: number } {
  const ceilingUsd = positionRiskCeilingNotional(exploreCapUsd, vol)
  return proposedUsd > ceilingUsd
    ? { notionalUsd: Math.max(0, ceilingUsd), capped: true, ceilingUsd }
    : { notionalUsd: proposedUsd, capped: false, ceilingUsd }
}

// ─── Daily closes (network, cached) ──────────────────────────────────────────

/** The Yahoo chart symbol for an app symbol, or null when there is no daily series. */
export function historySymbol(symbol: string, assetClass: string | null | undefined): string | null {
  const c = toRiskClass(assetClass)
  const s = symbol.trim().toUpperCase()
  if (!s || c === 'polymarket' || c === 'options') return null
  const fx = s.match(/^([A-Z]{3})[_/]?([A-Z]{3})$/)
  if (c === 'forex' || (c === 'multi-asset' && fx && /[_/]/.test(s))) {
    return fx ? `${fx[1]}${fx[2]}=X` : null
  }
  if (c === 'crypto') {
    const base = s.replace(/-ARB$/, '').replace(/[-/]?(?:USD|USDT|USDC|PERP)$/, '')
    return base ? `${base}-USD` : null
  }
  return s
}

const _closes = new Map<string, { closes: number[]; at: number }>()
const CLOSE_CACHE_MS = 12 * 3_600_000

export async function fetchDailyCloses(symbol: string, assetClass: string | null | undefined): Promise<number[]> {
  const ySym = historySymbol(symbol, assetClass)
  if (!ySym) return []
  const hit = _closes.get(ySym)
  if (hit && Date.now() - hit.at < CLOSE_CACHE_MS) return hit.closes
  try {
    const period2 = Math.floor(Date.now() / 1000)
    const period1 = period2 - VOL_LOOKBACK_DAYS * 86_400
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=1d&period1=${period1}&period2=${period2}`,
      { signal: AbortSignal.timeout(6_000) },
    )
    if (!res.ok) return []
    const data: unknown = await res.json()
    const result = ((data as Record<string, unknown>)?.chart as Record<string, unknown>)?.result as unknown[]
    const quote = (((result?.[0] as Record<string, unknown>)?.indicators as Record<string, unknown>)
      ?.quote as unknown[])?.[0] as Record<string, unknown>
    const closes = (quote?.close as Array<number | null> | undefined ?? [])
      .filter((c): c is number => typeof c === 'number' && c > 0)
    _closes.set(ySym, { closes, at: Date.now() })
    return closes
  } catch {
    return []
  }
}

/** Volatility for a symbol: realized when there's enough history, else the conservative default. */
export async function getAnnualVol(symbol: string, assetClass: string | null | undefined): Promise<VolEstimate> {
  if (isBinary(assetClass) || toRiskClass(assetClass) === 'options') return resolveVol(assetClass, [])
  return resolveVol(assetClass, await fetchDailyCloses(symbol, assetClass))
}
