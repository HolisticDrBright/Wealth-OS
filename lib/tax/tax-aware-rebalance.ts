/**
 * Tax-aware rebalancing helpers.
 *
 * The rebalance engine suggests class-level buys/sells based on drift alone.
 * These helpers estimate the *tax cost* of executing each sell so the user
 * can see the drag before approving — suggestions only, never auto-executed.
 *
 * Sell ordering preference:
 *   1. lots with losses (harvest the loss — negative tax cost)
 *   2. long-term gains (preferential LT rate)
 *   3. short-term gains last (taxed at ordinary rates — amber warning in UI)
 */

import type { TaxLot } from '@/lib/tax-lots'
import type { Asset } from '@/lib/types'

export const DEFAULT_ST_RATE = 0.35
export const DEFAULT_LT_RATE = 0.15

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function isLongTermHolding(acquiredDate: string, asOf: Date = new Date()): boolean {
  return asOf.getTime() - new Date(acquiredDate).getTime() > 365.25 * 24 * 60 * 60 * 1000
}

export interface TaxCostEstimate {
  gainLossUsd: number
  isLongTerm: boolean
  /** Positive = tax owed on sale; negative = tax benefit from harvesting a loss */
  taxCostUsd: number
  rateApplied: number
}

/**
 * Estimate the tax cost of fully liquidating a lot at the current price.
 * Losses produce a negative tax cost (an estimated benefit at the same rate).
 */
export function estimateTaxCost(
  lot: TaxLot,
  currentPrice: number,
  stRate = DEFAULT_ST_RATE,
  ltRate = DEFAULT_LT_RATE
): TaxCostEstimate {
  const longTerm = lot.isLongTerm ?? isLongTermHolding(lot.acquiredDate)
  const gainLossUsd = round2(lot.quantity * (currentPrice - lot.costBasis))
  const rateApplied = longTerm ? ltRate : stRate
  return {
    gainLossUsd,
    isLongTerm: longTerm,
    taxCostUsd: round2(gainLossUsd * rateApplied),
    rateApplied,
  }
}

export interface SellCandidate {
  lot: TaxLot
  currentPrice: number
}

export interface RankedSellCandidate extends SellCandidate {
  estimate: TaxCostEstimate
  /** 0 = loss (harvest), 1 = long-term gain, 2 = short-term gain */
  tier: 0 | 1 | 2
}

/**
 * Rank lots in tax-efficient sell order: losses first (biggest loss first),
 * then long-term gains (smallest gain first), then short-term gains last
 * (smallest gain first).
 */
export function rankSellCandidates(
  candidates: SellCandidate[],
  stRate = DEFAULT_ST_RATE,
  ltRate = DEFAULT_LT_RATE
): RankedSellCandidate[] {
  const ranked: RankedSellCandidate[] = candidates.map(c => {
    const estimate = estimateTaxCost(c.lot, c.currentPrice, stRate, ltRate)
    const tier: 0 | 1 | 2 = estimate.gainLossUsd < 0 ? 0 : estimate.isLongTerm ? 1 : 2
    return { ...c, estimate, tier }
  })

  return ranked.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    // Within losses: biggest loss first. Within gains: smallest gain first.
    return a.estimate.gainLossUsd - b.estimate.gainLossUsd
  })
}

export interface TaxDragResult {
  /** Estimated tax owed from this sell, USD (>= 0) */
  taxDragUsd: number
  /** True if executing the sell would realize short-term gains */
  sellsShortTermGains: boolean
  /** True if the sell harvests losses */
  harvestsLosses: boolean
}

/**
 * Estimate the tax drag of selling `sellNotionalUsd` out of an asset class,
 * assuming a tax-efficient sell order (losses → LT gains → ST gains).
 *
 * Each asset row is treated as a single lot. `purchase_price` is the total
 * cost basis for the position (consistent with the tax-advisor flow); assets
 * without a basis are treated as zero-gain (no drag contribution).
 */
export function estimateRebalanceTaxDrag(
  assets: Asset[],
  assetClass: string,
  sellNotionalUsd: number,
  stRate = DEFAULT_ST_RATE,
  ltRate = DEFAULT_LT_RATE
): TaxDragResult {
  const result: TaxDragResult = { taxDragUsd: 0, sellsShortTermGains: false, harvestsLosses: false }
  if (sellNotionalUsd <= 0) return result

  const candidates: SellCandidate[] = assets
    .filter(a => a.category === assetClass && a.current_value > 0)
    .map(a => {
      const quantity = a.quantity && a.quantity > 0 ? a.quantity : 1
      const currentPrice = a.current_value / quantity
      const totalBasis = a.purchase_price ?? a.current_value // no basis → assume no gain
      return {
        lot: {
          id: a.id,
          symbol: a.symbol ?? a.name,
          quantity,
          costBasis: totalBasis / quantity,
          acquiredDate: a.purchase_date ?? new Date().toISOString().slice(0, 10),
        },
        currentPrice,
      }
    })

  if (!candidates.length) return result

  const ranked = rankSellCandidates(candidates, stRate, ltRate)
  let remaining = sellNotionalUsd
  let taxDrag = 0

  for (const c of ranked) {
    if (remaining <= 0) break
    const lotValue = c.lot.quantity * c.currentPrice
    const fraction = Math.min(1, remaining / lotValue)
    const taxPortion = c.estimate.taxCostUsd * fraction

    taxDrag += taxPortion
    if (c.estimate.gainLossUsd > 0 && !c.estimate.isLongTerm) result.sellsShortTermGains = true
    if (c.estimate.gainLossUsd < 0) result.harvestsLosses = true
    remaining -= lotValue * fraction
  }

  // Net benefit from harvested losses can make this negative; report drag >= 0
  // separately from the harvest flag so the UI stays honest.
  result.taxDragUsd = round2(Math.max(0, taxDrag))
  return result
}
