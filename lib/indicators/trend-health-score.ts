/**
 * Trend Health Score — 0-100 composite indicator.
 * Surface in per-asset dashboard widget header as a 0-100 badge.
 * Weekly Review 2026-05-09
 *
 * Components:
 *   - % above 200 EMA   (weight 30)
 *   - ADX proxy         (weight 25) — uses mean directional movement
 *   - 50 EMA slope      (weight 25) — annualised slope direction
 *   - SMA50 deviation   (weight 20) — penalises extreme overextension
 */

export interface TrendHealthResult {
  score: number        // 0-100
  above200Ema: boolean
  emaSlope: 'rising' | 'flat' | 'falling'
  adxProxy: number     // 0-100
  deviationPct: number // % from SMA50
}

/** Compute EMA for a given period. Returns array same length as input. */
function computeEma(closes: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const ema = new Array<number>(closes.length)
  // Seed with first value
  ema[0] = closes[0]
  for (let i = 1; i < closes.length; i++) {
    ema[i] = closes[i] * k + ema[i - 1] * (1 - k)
  }
  return ema
}

/** Compute SMA for a given period over the last `period` bars. */
function computeSmaLast(closes: number[], period: number): number {
  const slice = closes.slice(closes.length - period)
  return slice.reduce((s, v) => s + v, 0) / slice.length
}

/** Clamp a value to [0, max]. */
function clamp(value: number, max = 100): number {
  return Math.max(0, Math.min(max, value))
}

export function computeTrendHealthScore(closes: number[]): TrendHealthResult {
  const defaults: TrendHealthResult = {
    score: 0,
    above200Ema: false,
    emaSlope: 'flat',
    adxProxy: 0,
    deviationPct: 0,
  }

  if (closes.length < 200) return defaults

  const last = closes[closes.length - 1]

  // --- 200 EMA component (weight 30) ---
  const ema200 = computeEma(closes, 200)
  const ema200Last = ema200[ema200.length - 1]
  const above200Ema = last > ema200Last
  // Score: 30 if above, 0 if below
  const component200Ema = above200Ema ? 30 : 0

  // --- 50 EMA slope component (weight 25) ---
  const ema50 = computeEma(closes, 50)
  const ema50Last = ema50[ema50.length - 1]
  // Compare last 10 bars of ema50 to determine slope
  const ema50Prev = ema50[ema50.length - 11]
  const emaSlopePct = ((ema50Last - ema50Prev) / ema50Prev) * 100

  let emaSlope: 'rising' | 'flat' | 'falling'
  let componentSlope: number
  if (emaSlopePct > 0.5) {
    emaSlope = 'rising'
    componentSlope = 25
  } else if (emaSlopePct < -0.5) {
    emaSlope = 'falling'
    componentSlope = 0
  } else {
    emaSlope = 'flat'
    componentSlope = 12
  }

  // --- ADX proxy component (weight 25) ---
  // Use mean absolute directional movement over last 14 bars
  // DM = |close[i] - close[i-1]| / close[i-1] * 100
  const adxWindow = 14
  const adxSlice = closes.slice(closes.length - adxWindow - 1)
  let sumDm = 0
  for (let i = 1; i < adxSlice.length; i++) {
    sumDm += Math.abs(adxSlice[i] - adxSlice[i - 1]) / adxSlice[i - 1]
  }
  const meanDm = (sumDm / adxWindow) * 100
  // Map meanDm to 0-100: 0% daily move = 0, >= 2% daily move = 100
  const adxProxy = clamp((meanDm / 2) * 100)
  const componentAdx = (adxProxy / 100) * 25

  // --- SMA50 deviation component (weight 20) ---
  // Optimal zone: within 5% of SMA50. Penalise >15% deviation.
  const sma50 = computeSmaLast(closes, 50)
  const deviationPct = ((last - sma50) / sma50) * 100
  const absDeviation = Math.abs(deviationPct)
  // Full 20 points if deviation < 5%, scales down linearly to 0 at >= 15%
  let componentDeviation: number
  if (absDeviation < 5) {
    componentDeviation = 20
  } else if (absDeviation >= 15) {
    componentDeviation = 0
  } else {
    componentDeviation = 20 * (1 - (absDeviation - 5) / 10)
  }

  const score = clamp(
    Math.round(component200Ema + componentSlope + componentAdx + componentDeviation)
  )

  return {
    score,
    above200Ema,
    emaSlope,
    adxProxy,
    deviationPct,
  }
}
