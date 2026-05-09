/**
 * RSI Divergence detector.
 * Used by: vcp_minervini, quant_momentum, qvm_multifactor, jpy_intervention_fade
 * Weekly Review 2026-05-09
 */

export interface DivergenceResult {
  detected: boolean
  /** Index of the pivot where divergence was confirmed (relative to end of array) */
  pivotOffset: number
}

/**
 * Returns indices of pivot lows within the slice [start, end) of an array.
 * A pivot low at index i: arr[i] < arr[i-1] && arr[i] < arr[i+1].
 */
function findPivotLows(arr: number[], start: number, end: number): number[] {
  const pivots: number[] = []
  for (let i = start + 1; i < end - 1; i++) {
    if (arr[i] < arr[i - 1] && arr[i] < arr[i + 1]) {
      pivots.push(i)
    }
  }
  return pivots
}

/**
 * Returns indices of pivot highs within the slice [start, end) of an array.
 * A pivot high at index i: arr[i] > arr[i-1] && arr[i] > arr[i+1].
 */
function findPivotHighs(arr: number[], start: number, end: number): number[] {
  const pivots: number[] = []
  for (let i = start + 1; i < end - 1; i++) {
    if (arr[i] > arr[i - 1] && arr[i] > arr[i + 1]) {
      pivots.push(i)
    }
  }
  return pivots
}

/**
 * Bullish divergence: price makes a lower low while RSI makes a higher low.
 * Requires at least 2 troughs in the lookback window.
 */
export function detectBullishDivergence(
  prices: number[],
  rsi: number[],
  lookback = 14
): DivergenceResult {
  if (prices.length < lookback || rsi.length < lookback || prices.length !== rsi.length) {
    return { detected: false, pivotOffset: 0 }
  }

  const n = prices.length
  const start = n - lookback
  const end = n

  const pricePivots = findPivotLows(prices, start, end)
  const rsiPivots = findPivotLows(rsi, start, end)

  // Need at least 2 pivot lows in each series
  if (pricePivots.length < 2 || rsiPivots.length < 2) {
    return { detected: false, pivotOffset: 0 }
  }

  // Compare the two most recent pivot lows
  const p1 = pricePivots[pricePivots.length - 2]
  const p2 = pricePivots[pricePivots.length - 1]
  const r1 = rsiPivots[rsiPivots.length - 2]
  const r2 = rsiPivots[rsiPivots.length - 1]

  // Bullish divergence: price lower low, RSI higher low
  const priceLowerLow = prices[p2] < prices[p1]
  const rsiHigherLow = rsi[r2] > rsi[r1]

  if (priceLowerLow && rsiHigherLow) {
    return { detected: true, pivotOffset: n - 1 - p2 }
  }

  return { detected: false, pivotOffset: 0 }
}

/**
 * Bearish divergence: price makes a higher high while RSI makes a lower high.
 */
export function detectBearishDivergence(
  prices: number[],
  rsi: number[],
  lookback = 14
): DivergenceResult {
  if (prices.length < lookback || rsi.length < lookback || prices.length !== rsi.length) {
    return { detected: false, pivotOffset: 0 }
  }

  const n = prices.length
  const start = n - lookback
  const end = n

  const pricePivots = findPivotHighs(prices, start, end)
  const rsiPivots = findPivotHighs(rsi, start, end)

  // Need at least 2 pivot highs in each series
  if (pricePivots.length < 2 || rsiPivots.length < 2) {
    return { detected: false, pivotOffset: 0 }
  }

  // Compare the two most recent pivot highs
  const p1 = pricePivots[pricePivots.length - 2]
  const p2 = pricePivots[pricePivots.length - 1]
  const r1 = rsiPivots[rsiPivots.length - 2]
  const r2 = rsiPivots[rsiPivots.length - 1]

  // Bearish divergence: price higher high, RSI lower high
  const priceHigherHigh = prices[p2] > prices[p1]
  const rsiLowerHigh = rsi[r2] < rsi[r1]

  if (priceHigherHigh && rsiLowerHigh) {
    return { detected: true, pivotOffset: n - 1 - p2 }
  }

  return { detected: false, pivotOffset: 0 }
}
