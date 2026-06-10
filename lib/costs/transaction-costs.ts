/**
 * Transaction cost models — per-venue fees + typical spreads.
 *
 * Backtests and the learning loop previously assumed zero-cost fills at the
 * midpoint, which silently flatters high-turnover and thin-market strategies.
 * Every cost here is a one-way cost in basis points of notional; a round trip
 * is 2× (entry + exit). Numbers are conservative public-tier estimates:
 *
 *   stocks      Alpaca: zero commission, but you cross ~half the NBBO spread.
 *   options     Wide spreads dominate; per-contract fees folded into bps.
 *   crypto      Kraken taker fee 26 bps (entry tier) + ~5 bps spread on majors.
 *   forex       OANDA spread ~1–2 pips on majors ≈ 2–4 bps; no commission.
 *   polymarket  No protocol fee, but books are thin — crossing the spread on a
 *               0–1 priced binary commonly costs 1–3 cents ≈ 100–300 bps.
 *               We use 150 bps as the honest middle.
 *   multi-asset Blend.
 */

import type { AssetClass } from '@/lib/strategies/strategy-registry'

export interface CostModel {
  /** Explicit venue fee, one-way, bps of notional. */
  feeBps: number
  /** Typical half-spread crossed on a marketable order, bps of notional. */
  halfSpreadBps: number
}

export const VENUE_COSTS: Record<AssetClass, CostModel> = {
  stocks:        { feeBps: 0,  halfSpreadBps: 4 },
  options:       { feeBps: 10, halfSpreadBps: 25 },
  crypto:        { feeBps: 26, halfSpreadBps: 5 },
  forex:         { feeBps: 0,  halfSpreadBps: 3 },
  polymarket:    { feeBps: 0,  halfSpreadBps: 150 },
  'multi-asset': { feeBps: 5,  halfSpreadBps: 8 },
}

/** One-way cost in bps for an asset class (fee + half-spread). */
export function oneWayCostBps(assetClass: AssetClass | string): number {
  const m = VENUE_COSTS[assetClass as AssetClass] ?? VENUE_COSTS['multi-asset']
  return m.feeBps + m.halfSpreadBps
}

/** Full round-trip (entry + exit) cost in bps. */
export function roundTripCostBps(assetClass: AssetClass | string): number {
  return 2 * oneWayCostBps(assetClass)
}

/** Round-trip cost in USD for a given notional. */
export function roundTripCostUsd(notionalUsd: number, assetClass: AssetClass | string): number {
  return notionalUsd * roundTripCostBps(assetClass) / 10_000
}

/**
 * Net a gross fractional return (e.g. 0.03 = +3%) down by the round-trip cost.
 * Used by the learning loop so calibration reflects what a real fill would
 * have earned, not the frictionless midpoint outcome.
 */
export function netReturn(grossReturn: number, assetClass: AssetClass | string): number {
  return grossReturn - roundTripCostBps(assetClass) / 10_000
}

/**
 * Whether a strategy's expected edge clears its costs with margin.
 * The standard bar: gross edge must be at least 2× the round trip, otherwise
 * estimation error eats the rest.
 */
export function edgeClearsCosts(expectedReturn: number, assetClass: AssetClass | string): {
  clears: boolean
  grossBps: number
  costBps: number
  netBps: number
} {
  const grossBps = expectedReturn * 10_000
  const costBps = roundTripCostBps(assetClass)
  return {
    clears: grossBps >= 2 * costBps,
    grossBps: Math.round(grossBps),
    costBps,
    netBps: Math.round(grossBps - costBps),
  }
}
