/**
 * Support/Resistance level detector.
 * Used by: session_breakout (forex), gamma_exposure (stocks) for stop placement.
 * Weekly Review 2026-05-09
 *
 * Algorithm:
 *   1. Find all pivot highs and lows in the window
 *   2. Compute ATR over the window
 *   3. Cluster levels within 0.5 ATR
 *   4. Return top 3 support levels (highest strength) and top 3 resistance levels
 */

export interface PriceBar {
  high: number
  low: number
  close: number
}

export interface SRLevel {
  price: number       // cluster centroid
  strength: number    // 0-1, based on number of touches relative to window
  touches: number     // raw count of pivot points in this cluster
}

export interface SRLevels {
  support: SRLevel[]     // up to 3, sorted by strength desc
  resistance: SRLevel[]  // up to 3, sorted by strength desc
}

/** Compute average ATR (high - low) over the given bars. */
function computeAtr(bars: PriceBar[]): number {
  if (bars.length === 0) return 0
  const sum = bars.reduce((s, b) => s + (b.high - b.low), 0)
  return sum / bars.length
}

/**
 * Cluster a sorted list of price levels within `tolerance`.
 * Returns clusters as arrays of prices.
 */
function clusterLevels(levels: number[], tolerance: number): number[][] {
  if (levels.length === 0) return []
  const sorted = [...levels].sort((a, b) => a - b)
  const clusters: number[][] = [[sorted[0]]]

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]
    const lastCluster = clusters[clusters.length - 1]
    const clusterMean = lastCluster.reduce((s, v) => s + v, 0) / lastCluster.length
    if (Math.abs(current - clusterMean) <= tolerance) {
      lastCluster.push(current)
    } else {
      clusters.push([current])
    }
  }

  return clusters
}

/** Convert clusters to SRLevel objects. */
function clustersToLevels(clusters: number[][], windowSize: number): SRLevel[] {
  return clusters.map((cluster) => {
    const centroid = cluster.reduce((s, v) => s + v, 0) / cluster.length
    const touches = cluster.length
    const strength = Math.min(touches / Math.max(windowSize / 10, 1), 1)
    return { price: centroid, strength, touches }
  })
}

export function detectSRLevels(prices: PriceBar[], window = 50): SRLevels {
  const empty: SRLevels = { support: [], resistance: [] }

  if (prices.length < 5) return empty

  // Use last `window` bars
  const bars = prices.slice(Math.max(0, prices.length - window))
  const n = bars.length

  if (n < 5) return empty

  const atr = computeAtr(bars)
  const tolerance = atr * 0.5

  // Find pivot highs (resistance candidates)
  const pivotHighPrices: number[] = []
  for (let i = 1; i < n - 1; i++) {
    if (bars[i].high > bars[i - 1].high && bars[i].high > bars[i + 1].high) {
      pivotHighPrices.push(bars[i].high)
    }
  }

  // Find pivot lows (support candidates)
  const pivotLowPrices: number[] = []
  for (let i = 1; i < n - 1; i++) {
    if (bars[i].low < bars[i - 1].low && bars[i].low < bars[i + 1].low) {
      pivotLowPrices.push(bars[i].low)
    }
  }

  // Cluster and convert to SRLevel
  const resistanceClusters = clusterLevels(pivotHighPrices, tolerance)
  const supportClusters = clusterLevels(pivotLowPrices, tolerance)

  const resistanceLevels = clustersToLevels(resistanceClusters, n)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3)

  const supportLevels = clustersToLevels(supportClusters, n)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3)

  return {
    support: supportLevels,
    resistance: resistanceLevels,
  }
}
