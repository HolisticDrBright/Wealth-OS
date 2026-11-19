/**
 * Product defaults — the ONE place for every allocation and risk threshold the
 * wealth-management layer uses. Every value here is a PRODUCT DEFAULT you can
 * change; nothing else in the codebase should hardcode these numbers.
 *
 * Fractions are 0–1 unless the name says PCT.
 */

// ─── Core funds (Tier 2 Core + Tier 1 Safety) ────────────────────────────────

/** Product default: the four funds Core and Safety hold, one ticker per slot. */
export const CORE_FUNDS = {
  usStocks: 'VTI',     // Vanguard Total Stock Market
  intlStocks: 'VXUS',  // Vanguard Total International Stock
  bonds: 'BND',        // Vanguard Total Bond Market
  cashLike: 'SGOV',    // iShares 0–3 Month Treasury Bond (Tier 1 Safety)
} as const

/** Product default: share of the STOCK portion held in US stocks (rest international). */
export const US_SHARE_OF_STOCKS = 0.70

// ─── Risk-profile mix (before horizon glide path) ────────────────────────────

/**
 * Product default: each risk profile's long-horizon mix of stocks / bonds /
 * cash, as fractions summing to 1. Core never holds crypto — crypto exposure
 * lives only in Explore. Carried over unchanged from the previous
 * coreAllocationFor() so Phase 1 is a pure consolidation.
 */
export const PROFILE_MIX: Record<string, { stocks: number; bonds: number; cash: number }> = {
  vault:        { stocks: 0.20, bonds: 0.60, cash: 0.20 },
  conservative: { stocks: 0.40, bonds: 0.50, cash: 0.10 },
  balanced:     { stocks: 0.60, bonds: 0.35, cash: 0.05 },
  growth:       { stocks: 0.80, bonds: 0.18, cash: 0.02 },
  speculative:  { stocks: 0.90, bonds: 0.08, cash: 0.02 },
}

/** Product default: profile used when a user has none recorded. */
export const DEFAULT_PROFILE_KEY = 'balanced'

// ─── Explore (Tier 3) ────────────────────────────────────────────────────────

/** Product default: Explore's share of portfolio value for new users. */
export const DEFAULT_EXPLORE_CAP_FRACTION = 0.10

/** Product default: the HARD ceiling on Explore — no user setting may exceed it. */
export const EXPLORE_CAP_HARD_MAX_FRACTION = 0.25
