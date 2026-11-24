/**
 * "Edge beyond luck" (roadmap #4) — PURE. With dozens of strategies under
 * test, some will look good by chance. A strategy's per-trade net returns must
 * show a one-sided t-statistic above the Bonferroni-corrected threshold
 * z = Φ⁻¹(1 − α / m), where m is the number of strategies being tested.
 */

import { LUCK_FAMILY_ALPHA } from '@/lib/config/product-defaults'

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError('p must be in (0, 1)')
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01]
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]
  const lo = 0.02425, hi = 1 - lo
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > hi) return -normalQuantile(1 - p)
  const q = p - 0.5, r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

/** The t-statistic a strategy must clear when `strategiesTested` are being tested at once. */
export function luckThreshold(strategiesTested: number, alpha: number = LUCK_FAMILY_ALPHA): number {
  const m = Math.max(1, Math.floor(strategiesTested))
  return normalQuantile(1 - alpha / m)
}

/** One-sided t-statistic of the mean (null with fewer than 2 values or no spread). */
export function tStat(values: number[]): number | null {
  const n = values.length
  if (n < 2) return null
  const mean = values.reduce((s, v) => s + v, 0) / n
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
  return sd > 0 ? mean / (sd / Math.sqrt(n)) : null
}
