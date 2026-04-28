/**
 * Binomial p-value calculation.
 * Methodology adapted from suislanchez/polymarket-insider-detector.
 */

/**
 * P(X >= wins | n=total, p=nullProb) using normal approximation when valid,
 * exact binomial sum otherwise. Returns value in [0, 1].
 */
export function binomialPValue(
  wins: number,
  total: number,
  nullProb = 0.5
): number {
  if (total <= 0) return 1
  if (wins < 0) return 1
  if (wins > total) return 0
  const np = total * nullProb
  const nq = total * (1 - nullProb)

  if (np > 5 && nq > 5) {
    // Normal approximation with continuity correction
    const mean = np
    const std = Math.sqrt(total * nullProb * (1 - nullProb))
    const z = (wins - 0.5 - mean) / std
    return 1 - normalCdf(z)
  }

  // Exact: P(X >= wins) = sum_{k=wins}^{n} C(n,k) p^k (1-p)^(n-k)
  let pValue = 0
  for (let k = wins; k <= total; k++) {
    pValue += binomCoeffLog(total, k, nullProb)
  }
  return Math.min(1, Math.max(0, pValue))
}

/** Returns true when the win count is statistically improbable under null hypothesis p=0.5. */
export function isStatisticallyImprobable(
  wins: number,
  total: number,
  alpha = 0.001
): boolean {
  return binomialPValue(wins, total) < alpha
}

// --- Helpers -----------------------------------------------------------------

/** Abramowitz & Stegun 26.2.17 normal CDF approximation. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const poly =
    t * (0.319381530 +
    t * (-0.356563782 +
    t * (1.781477937 +
    t * (-1.821255978 +
    t * 1.330274429))))
  const p = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly
  return z >= 0 ? p : 1 - p
}

/**
 * Compute C(n,k) * p^k * (1-p)^(n-k) in log space to avoid overflow.
 */
function binomCoeffLog(n: number, k: number, p: number): number {
  if (k < 0 || k > n) return 0
  let logProb = 0
  for (let i = 0; i < k; i++) {
    logProb += Math.log(n - i) - Math.log(i + 1)
  }
  logProb += k * Math.log(p) + (n - k) * Math.log(1 - p)
  return Math.exp(logProb)
}
