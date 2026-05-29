/**
 * Pure risk-level mapping helpers, shared by RiskBadges and tested directly.
 * Keep DOM-free so they're unit-testable under the node test environment.
 */
export type RiskLevel = 'ok' | 'caution' | 'risk' | 'unknown'

/** Map a Brier score [0,1] (lower=better) to a calibration risk level + label. */
export function brierToLevel(brier: number | null | undefined): { level: RiskLevel; value: string } {
  if (brier == null || !isFinite(brier)) return { level: 'unknown', value: 'n/a' }
  if (brier <= 0.18) return { level: 'ok', value: brier.toFixed(2) }
  if (brier <= 0.25) return { level: 'caution', value: brier.toFixed(2) }
  return { level: 'risk', value: brier.toFixed(2) }
}

/** Map a fraction of the position cap consumed [0,1+] to a level + percent label. */
export function capUtilToLevel(usedPct: number | null | undefined): { level: RiskLevel; value: string } {
  if (usedPct == null || !isFinite(usedPct)) return { level: 'unknown', value: 'n/a' }
  const v = `${Math.round(usedPct * 100)}%`
  if (usedPct < 0.6) return { level: 'ok', value: v }
  if (usedPct < 0.9) return { level: 'caution', value: v }
  return { level: 'risk', value: v }
}
