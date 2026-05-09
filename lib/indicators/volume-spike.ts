/**
 * Volume spike detector.
 * Used by: vcp_minervini, pead_microcap_text (quality filter — skip if !isVolumeSpike)
 * Weekly Review 2026-05-09
 */

export interface VolumeBar {
  volume: number
}

/**
 * Returns true when currentBar.volume exceeds threshold × average of lookback bars.
 * @param currentBar   The bar being evaluated
 * @param lookback     Historical bars to compute average against (NOT including currentBar)
 * @param threshold    Multiplier; default 3 = 3x average volume
 */
export function isVolumeSpike(
  currentBar: VolumeBar,
  lookback: VolumeBar[],
  threshold = 3
): boolean {
  if (lookback.length === 0) return false
  const avg = lookback.reduce((s, b) => s + b.volume, 0) / lookback.length
  return avg > 0 && currentBar.volume > avg * threshold
}
