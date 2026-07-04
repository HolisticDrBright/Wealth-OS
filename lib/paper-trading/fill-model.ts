/**
 * Paper fill model (validation item 10) — simple, DETERMINISTIC realism
 * improvements over a flat slippage constant. Assumptions are explicit so
 * the runbook can compare recorded fills against them:
 *
 *  1. SPREAD: every fill pays a fixed half-spread per asset class (bps).
 *     Longs fill above mid, shorts below; neutral enters at mid + spread.
 *  2. IMPACT: price impact grows LINEARLY with order size relative to a
 *     per-asset-class liquidity reference: impactBps = baseBps × notional/ref.
 *     Linear impact is a conservative simplification of square-root impact
 *     for the small notionals the paper phase trades.
 *  3. PARTIAL FILLS: notional above the per-asset-class depth cap fills only
 *     up to the cap (the book cannot absorb more at modeled cost).
 *  4. REJECTION: when total modeled cost (spread + impact) exceeds the
 *     rejection threshold, the order is REJECTED — a real router would not
 *     cross a book that wide. Deterministic, never random.
 *
 * All parameters are estimates chosen to be conservative (worse than typical
 * live conditions) so paper results UNDERSTATE live performance rather than
 * flatter it.
 */

export interface FillModelParams {
  /** Half-spread paid on every fill (bps). */
  halfSpreadBps: number
  /** Base impact at `liquidityRefUsd` notional (bps). */
  impactBps: number
  /** Notional at which impact equals impactBps. */
  liquidityRefUsd: number
  /** Max notional fillable in one order (partial fill above this). */
  depthCapUsd: number
  /** Reject when spread+impact exceeds this (bps). */
  rejectAboveBps: number
}

export const FILL_MODEL: Record<string, FillModelParams> = {
  crypto:        { halfSpreadBps: 2,  impactBps: 3,  liquidityRefUsd: 50_000, depthCapUsd: 250_000, rejectAboveBps: 50 },
  stocks:        { halfSpreadBps: 3,  impactBps: 7,  liquidityRefUsd: 50_000, depthCapUsd: 500_000, rejectAboveBps: 60 },
  options:       { halfSpreadBps: 10, impactBps: 10, liquidityRefUsd: 10_000, depthCapUsd: 50_000,  rejectAboveBps: 120 },
  forex:         { halfSpreadBps: 1,  impactBps: 2,  liquidityRefUsd: 100_000, depthCapUsd: 1_000_000, rejectAboveBps: 30 },
  polymarket:    { halfSpreadBps: 8,  impactBps: 7,  liquidityRefUsd: 2_000,  depthCapUsd: 10_000,  rejectAboveBps: 150 },
  'multi-asset': { halfSpreadBps: 3,  impactBps: 7,  liquidityRefUsd: 50_000, depthCapUsd: 500_000, rejectAboveBps: 60 },
}

const DEFAULT_MODEL: FillModelParams =
  { halfSpreadBps: 5, impactBps: 5, liquidityRefUsd: 25_000, depthCapUsd: 100_000, rejectAboveBps: 60 }

export interface ModeledFill {
  status: 'filled' | 'partial' | 'rejected'
  fillPrice: number
  /** Total modeled cost actually paid (bps, spread + impact on filled size). */
  slippageBps: number
  /** Notional that actually filled (≤ requested). */
  filledNotionalUsd: number
  reason?: string
}

/**
 * Deterministic modeled fill. Direction 'long' pays up, 'short' receives
 * less, 'neutral' still pays the spread (entries are never free).
 */
export function modelFill(args: {
  assetClass: string
  price: number
  direction: 'long' | 'short' | 'neutral'
  notionalUsd: number
}): ModeledFill {
  const p = FILL_MODEL[args.assetClass] ?? DEFAULT_MODEL

  // Partial fill: the book absorbs at most depthCapUsd at modeled cost.
  const filledNotionalUsd = Math.min(args.notionalUsd, p.depthCapUsd)
  const partial = filledNotionalUsd < args.notionalUsd

  const impactBps = p.impactBps * (filledNotionalUsd / p.liquidityRefUsd)
  const totalBps = p.halfSpreadBps + impactBps

  if (totalBps > p.rejectAboveBps) {
    return {
      status: 'rejected',
      fillPrice: args.price,
      slippageBps: Math.round(totalBps * 100) / 100,
      filledNotionalUsd: 0,
      reason: `modeled cost ${totalBps.toFixed(1)} bps exceeds ${p.rejectAboveBps} bps rejection threshold (order too large for modeled liquidity)`,
    }
  }

  const slip = args.price * totalBps / 10_000
  const fillPrice =
    args.direction === 'long' ? args.price + slip
    : args.direction === 'short' ? args.price - slip
    : args.price + slip   // neutral entries still pay the spread

  return {
    status: partial ? 'partial' : 'filled',
    fillPrice,
    slippageBps: Math.round(totalBps * 100) / 100,
    filledNotionalUsd,
    ...(partial ? { reason: `partial fill: depth cap $${p.depthCapUsd.toLocaleString()} < requested $${Math.round(args.notionalUsd).toLocaleString()}` } : {}),
  }
}
