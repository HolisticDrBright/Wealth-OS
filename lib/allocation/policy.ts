/**
 * Allocation policy — the SINGLE source of target allocations.
 *
 * Every screen and engine that needs "what should this person hold" asks this
 * module: the Core sleeve bootstrap, the rebalance engine's default targets,
 * the recommended-allocation panels, and the planning Monte Carlo's Explore
 * bucket. Numbers come from lib/config/product-defaults.ts.
 *
 * Core holds stocks (US + international), bonds and cash-like funds only.
 * Crypto exposure lives only in Explore.
 */

import {
  CORE_FUNDS, US_SHARE_OF_STOCKS, PROFILE_MIX, DEFAULT_PROFILE_KEY,
  DEFAULT_EXPLORE_CAP_FRACTION,
} from '@/lib/config/product-defaults'

export type CoreAssetClass = 'stock' | 'bond' | 'cash'
export type CoreFundSlot = keyof typeof CORE_FUNDS

export interface ProfileMix {
  stocks: number
  bonds: number
  cash: number
}

/** The profile's long-horizon mix (fractions summing to 1). Unknown → default profile. */
export function profileMix(profileKey: string | null | undefined): ProfileMix {
  return PROFILE_MIX[profileKey ?? ''] ?? PROFILE_MIX[DEFAULT_PROFILE_KEY]
}

/**
 * Core mix in whole percentages, for display and sleeve metadata.
 * (Shape kept compatible with the old coreAllocationFor().)
 */
export function corePercentages(profileKey: string | null | undefined): { stocksPct: number; bondsPct: number; cashPct: number } {
  const m = profileMix(profileKey)
  return {
    stocksPct: Math.round(m.stocks * 100),
    bondsPct: Math.round(m.bonds * 100),
    cashPct: Math.round(m.cash * 100),
  }
}

export interface FundTarget {
  slot: CoreFundSlot
  symbol: string
  assetClass: CoreAssetClass
  /** Fraction of Core (0–1). */
  weight: number
}

/** Core broken into the four configured funds (fractions of Core summing to 1). */
export function coreFundTargets(profileKey: string | null | undefined): FundTarget[] {
  const m = profileMix(profileKey)
  return [
    { slot: 'usStocks',   symbol: CORE_FUNDS.usStocks,   assetClass: 'stock', weight: m.stocks * US_SHARE_OF_STOCKS },
    { slot: 'intlStocks', symbol: CORE_FUNDS.intlStocks, assetClass: 'stock', weight: m.stocks * (1 - US_SHARE_OF_STOCKS) },
    { slot: 'bonds',      symbol: CORE_FUNDS.bonds,      assetClass: 'bond',  weight: m.bonds },
    { slot: 'cashLike',   symbol: CORE_FUNDS.cashLike,   assetClass: 'cash',  weight: m.cash },
  ]
}

/** The fund a Core asset class trades through (stock → the US fund). */
export function fundForAssetClass(assetClass: string): string | null {
  switch (assetClass) {
    case 'stock': return CORE_FUNDS.usStocks
    case 'bond':  return CORE_FUNDS.bonds
    case 'cash':  return CORE_FUNDS.cashLike
    default:      return null   // crypto/real_estate/other are not Core
  }
}

export interface RebalanceTargetDefault {
  asset_class: CoreAssetClass
  target_pct: number
}

/**
 * Default rebalance targets (whole percentages) when the user has saved none.
 * Stocks / bonds / cash only — never crypto, never 'other'.
 */
export function defaultRebalanceTargets(profileKey: string | null | undefined): RebalanceTargetDefault[] {
  const p = corePercentages(profileKey)
  return [
    { asset_class: 'stock', target_pct: p.stocksPct },
    { asset_class: 'bond',  target_pct: p.bondsPct },
    { asset_class: 'cash',  target_pct: p.cashPct },
  ]
}

export interface RecommendedSlice {
  key: 'us_stocks' | 'intl_stocks' | 'bonds' | 'cash' | 'explore'
  label: string
  /** Whole-portfolio share, 0–100. */
  pct: number
}

/**
 * The recommended WHOLE-portfolio mix: Core funds scaled to (1 − Explore cap)
 * plus the Explore slice. This replaces the risk_profiles.alloc_* seed (which
 * recommended 20% crypto, 15% options, etc.) on every recommended-allocation
 * panel.
 */
export function recommendedPortfolio(
  profileKey: string | null | undefined,
  exploreCapFraction: number = DEFAULT_EXPLORE_CAP_FRACTION,
): RecommendedSlice[] {
  const coreShare = 1 - exploreCapFraction
  const funds = coreFundTargets(profileKey)
  const w = (slot: CoreFundSlot) => funds.find(f => f.slot === slot)!.weight
  const pct = (x: number) => Math.round(x * 1000) / 10
  return [
    { key: 'us_stocks',   label: `US stocks (${CORE_FUNDS.usStocks})`,             pct: pct(w('usStocks') * coreShare) },
    { key: 'intl_stocks', label: `International stocks (${CORE_FUNDS.intlStocks})`, pct: pct(w('intlStocks') * coreShare) },
    { key: 'bonds',       label: `Bonds (${CORE_FUNDS.bonds})`,                     pct: pct(w('bonds') * coreShare) },
    { key: 'cash',        label: `Cash-like (${CORE_FUNDS.cashLike})`,              pct: pct(w('cashLike') * coreShare) },
    { key: 'explore',     label: 'Explore (strategies + copying)',                  pct: pct(exploreCapFraction) },
  ]
}

/**
 * Planning Monte Carlo buckets: the Explore sleeve is the policy's Explore
 * share of investable; the rest is the market (Core) bucket.
 */
export function planningBuckets(
  investableUsd: number,
  exploreCapFraction: number = DEFAULT_EXPLORE_CAP_FRACTION,
): { marketBucketUsd: number; sleeveUsd: number } {
  const sleeveUsd = Math.max(0, Math.min(investableUsd * exploreCapFraction, investableUsd))
  return { marketBucketUsd: Math.max(0, investableUsd - sleeveUsd), sleeveUsd }
}
