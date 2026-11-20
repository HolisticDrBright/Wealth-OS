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
  DEFAULT_EXPLORE_CAP_FRACTION, EXPLORE_CAP_HARD_MAX_FRACTION,
  SHORT_HORIZON_YEARS, GLIDE_FULL_HORIZON_YEARS, GLIDE_SHORT_FRACTION,
  PROFILE_TILT_MAX, GLIDE_REFERENCE_PROFILE,
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

// ─── Explore cap clamp (pure) ────────────────────────────────────────────────

/** A user's Explore cap fraction, defaulted and clamped to the hard maximum. */
export function clampExploreCapFraction(f: number | null | undefined): number {
  if (f == null || !Number.isFinite(f) || f < 0) return DEFAULT_EXPLORE_CAP_FRACTION
  return Math.min(EXPLORE_CAP_HARD_MAX_FRACTION, f)
}

// ─── Glide path (Phase 2) ────────────────────────────────────────────────────
// Horizon sets the Core stock/bond split; the risk profile only adjusts it.
//   goal ≥ GLIDE_FULL_HORIZON_YEARS away  → the profile's long-horizon share
//   between that and SHORT_HORIZON_YEARS  → steps down linearly to
//                                           GLIDE_SHORT_FRACTION of it
//   under SHORT_HORIZON_YEARS             → the goal's money is Tier 1, not Core
// The profile's long-horizon share is its own PROFILE_MIX stock share, capped
// at PROFILE_TILT_MAX above the reference profile — so the glide path's
// ceiling at any horizon is the reference share + tilt, glided the same way.

const MS_PER_YEAR = 365.25 * 86_400_000

/** Years from `now` until an ISO date; null date = no fixed date (treated as long horizon). */
export function yearsUntil(dateIso: string | null | undefined, now: Date = new Date()): number | null {
  if (!dateIso) return null
  const t = new Date(dateIso).getTime()
  if (!Number.isFinite(t)) return null
  return (t - now.getTime()) / MS_PER_YEAR
}

/** True when a goal's money belongs in Tier 1 (due within SHORT_HORIZON_YEARS, or overdue). */
export function isShortHorizon(years: number | null): boolean {
  return years != null && years < SHORT_HORIZON_YEARS
}

/** Glide multiplier on the long-horizon share: 1 at ≥10y, linear to GLIDE_SHORT_FRACTION at 2y. */
export function glideFraction(years: number | null): number {
  if (years == null || years >= GLIDE_FULL_HORIZON_YEARS) return 1
  if (years <= SHORT_HORIZON_YEARS) return GLIDE_SHORT_FRACTION
  const t = (years - SHORT_HORIZON_YEARS) / (GLIDE_FULL_HORIZON_YEARS - SHORT_HORIZON_YEARS)
  return GLIDE_SHORT_FRACTION + t * (1 - GLIDE_SHORT_FRACTION)
}

/** The profile's long-horizon stock share: its own share, never more than tilt-max above the reference. */
export function longHorizonStockShare(profileKey: string | null | undefined): number {
  const own = profileMix(profileKey).stocks
  const reference = profileMix(GLIDE_REFERENCE_PROFILE).stocks
  return Math.min(own, reference + PROFILE_TILT_MAX)
}

/** The glide path's ceiling at a horizon: no profile may hold more stock than this. */
export function glideCeiling(years: number | null): number {
  return (profileMix(GLIDE_REFERENCE_PROFILE).stocks + PROFILE_TILT_MAX) * glideFraction(years)
}

/** Core stock share for ONE goal at a horizon (bonds = 1 − this). */
export function goalStockShare(years: number | null, profileKey: string | null | undefined): number {
  return Math.min(glideCeiling(years), longHorizonStockShare(profileKey) * glideFraction(years))
}

export interface GoalForMix {
  targetAmountUsd: number
  targetDate: string | null
}

/**
 * Core stock share across several goals: each Core goal's glide-path share,
 * blended by its target dollars. Goals inside SHORT_HORIZON_YEARS are Tier 1
 * and excluded. With no Core goals, the profile's long-horizon share applies.
 */
export function coreStockShare(
  goals: GoalForMix[],
  profileKey: string | null | undefined,
  now: Date = new Date(),
): number {
  let weighted = 0
  let dollars = 0
  for (const g of goals) {
    const years = yearsUntil(g.targetDate, now)
    if (isShortHorizon(years)) continue
    const w = Math.max(0, g.targetAmountUsd)
    if (w <= 0) continue
    weighted += w * goalStockShare(years, profileKey)
    dollars += w
  }
  return dollars > 0 ? weighted / dollars : longHorizonStockShare(profileKey)
}

/** Core broken into funds for a given stock share (Core holds no cash — that is Tier 1). */
export function coreFundsForStockShare(stockShare: number): FundTarget[] {
  const s = Math.max(0, Math.min(1, stockShare))
  return [
    { slot: 'usStocks',   symbol: CORE_FUNDS.usStocks,   assetClass: 'stock', weight: s * US_SHARE_OF_STOCKS },
    { slot: 'intlStocks', symbol: CORE_FUNDS.intlStocks, assetClass: 'stock', weight: s * (1 - US_SHARE_OF_STOCKS) },
    { slot: 'bonds',      symbol: CORE_FUNDS.bonds,      assetClass: 'bond',  weight: 1 - s },
  ]
}
