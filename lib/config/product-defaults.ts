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

// ─── Tier 1 Safety ───────────────────────────────────────────────────────────

/** Product default: emergency fund size, in months of essential expenses. */
export const EMERGENCY_FUND_MONTHS = 6

/**
 * Product default: a goal due within this many years is held in full in
 * Tier 1 (cash-like), not invested in Core.
 */
export const SHORT_HORIZON_YEARS = 2

/** Product default: recorded-asset categories that count as Tier 1 cash-like money. */
export const CASH_LIKE_CATEGORIES = ['cash']

/** Product default: recorded-asset categories that are not investable money (excluded from the ladder). */
export const LADDER_EXCLUDED_CATEGORIES = ['real_estate']

// ─── Tier 2 Core glide path ──────────────────────────────────────────────────

/** Product default: at or beyond this horizon a goal holds its full long-horizon stock share. */
export const GLIDE_FULL_HORIZON_YEARS = 10

/**
 * Product default: at SHORT_HORIZON_YEARS the stock share has glided down to
 * this fraction of its long-horizon value (0.25 → balanced 60% → 15%).
 * Below SHORT_HORIZON_YEARS the goal's money moves to Tier 1 entirely.
 */
export const GLIDE_SHORT_FRACTION = 0.25

/**
 * Product default: a risk profile's long-horizon stock share may sit at most
 * this far ABOVE the reference profile's (owner decision: the tilt caps the
 * upside only; conservative profiles keep their lower share).
 */
export const PROFILE_TILT_MAX = 0.15

/** Product default: the profile the tilt is measured from. */
export const GLIDE_REFERENCE_PROFILE = 'balanced'

/**
 * Product default: when Core's stock (or bond) share drifts more than this
 * many points (as a fraction) from its glide-path target, a rebalance
 * decision is raised. Core is never traded without approval.
 */
export const CORE_DRIFT_THRESHOLD = 0.05

/** Product default: Core / Safety fund trades smaller than this are skipped (dust). */
export const CORE_MIN_TRADE_USD = 10

// ─── Explore (Tier 3) ────────────────────────────────────────────────────────

/** Product default: Explore's share of portfolio value for new users. */
export const DEFAULT_EXPLORE_CAP_FRACTION = 0.10

/** Product default: the HARD ceiling on Explore — no user setting may exceed it. */
export const EXPLORE_CAP_HARD_MAX_FRACTION = 0.25

// ─── Risk units (Phase 4) ────────────────────────────────────────────────────
// A position's risk units = notional × annualized volatility (a binary
// prediction market: the stake, its maximum loss). Every rule built on them
// is an ADDITIONAL gate — it can only shrink or block a trade.

/**
 * Product default: realized volatility is used only when at least this many
 * daily returns are available; otherwise the conservative per-asset-class
 * default below applies.
 */
export const VOL_MIN_OBSERVATIONS = 20

/** Product default: calendar days of daily closes used for realized volatility. */
export const VOL_LOOKBACK_DAYS = 90

/**
 * Product default: conservative annualized volatility per asset class, used
 * when realized volatility can't be measured. Set at or above what each class
 * typically shows so a missing history never makes a trade look safer.
 * Options always use this (an option can lose its whole premium).
 */
export const DEFAULT_ANNUAL_VOL: Record<string, number> = {
  stocks: 0.40,
  options: 1.00,
  crypto: 0.90,
  forex: 0.15,
  'multi-asset': 0.40,
}

/** Product default: realized volatility is never taken below this (quiet spells aren't safety). */
export const VOL_FLOOR_ANNUAL = 0.05

/**
 * Product default: the reference volatility that turns Explore's dollar cap
 * into a risk budget (Explore risk budget = Explore cap dollars × this).
 * Roughly a broad stock index's annual volatility.
 */
export const EXPLORE_RISK_REFERENCE_VOL = 0.20

/**
 * Product default: one position may use at most this share of the Explore
 * risk budget (owner decision: measured against the Explore risk budget).
 */
export const MAX_POSITION_RISK_SHARE = 0.20

// ─── Strategy books (Phase 5) ────────────────────────────────────────────────

/**
 * Product default: the most of open strategy notional (and, Phase 4, of open
 * risk units) the 'speculative' book may hold. Lottery-ticket strategies
 * (memecoins, airdrop farming, 5-minute crypto binaries) live here.
 */
export const SPECULATIVE_BOOK_CAP = 0.10

/**
 * Product default: regime multipliers for the speculative book (owner
 * decision: half size even in RISK_ON; closed in RISK_OFF and CRISIS).
 */
export const SPECULATIVE_REGIME_MULTIPLIER = {
  RISK_ON: 0.5,
  NEUTRAL: 0.5,
  RISK_OFF: 0,
  CRISIS: 0,
} as const
