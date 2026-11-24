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

// ─── Track record (Phase 6) ──────────────────────────────────────────────────

/**
 * Product default: during US market hours, if no SCHEDULED scan has finished
 * successfully for this many hours, an alert is raised and a banner shows on
 * every page. Past stretches like that are flagged as gaps in a strategy's
 * track record.
 */
export const SCAN_STALE_HOURS = 6

/** Product default: the market clock used for "market hours" (US equities). */
export const MARKET_TIMEZONE = 'America/New_York'

/** Product default: market open / close, minutes after local midnight (9:30 / 16:00). */
export const MARKET_OPEN_MINUTES = 9 * 60 + 30
export const MARKET_CLOSE_MINUTES = 16 * 60

/** Product default: how far back the readiness page looks for scan gaps. */
export const SCAN_GAP_LOOKBACK_DAYS = 90

// ─── Best next dollar (roadmap #1) ───────────────────────────────────────────

/**
 * Product default: a reported income at least this much above the last one
 * we acknowledged counts as a raise and prompts a higher monthly deposit.
 */
export const RAISE_MIN_INCREASE = 0.03

/** Product default: rough share of a gross raise that reaches the paycheck after tax. */
export const RAISE_TAKE_HOME_FRACTION = 0.70

/** Product default: the share of the after-tax raise we suggest saving ("save half your raise"). */
export const RAISE_SAVE_SHARE = 0.50

/** Product default: suggested deposit changes are rounded to this many dollars. */
export const DEPOSIT_ROUND_USD = 5

// ─── Explore must beat Core (roadmap #3) ─────────────────────────────────────

/** Product default: closed Explore trades from this many days back are compared with Core. */
export const EXPLORE_REVIEW_LOOKBACK_DAYS = 365

/**
 * Product default: a "meaningful stretch" — the comparison only counts once
 * the first compared trade is at least this many days old…
 */
export const EXPLORE_REVIEW_MIN_DAYS = 180

/** Product default: …and at least this many closed trades were compared. */
export const EXPLORE_REVIEW_MIN_TRADES = 30

/** Product default: when Explore trails Core, the proposal multiplies the Explore limit by this. */
export const EXPLORE_SHRINK_FACTOR = 0.5

/** Product default: a shrink proposal never goes below this Explore share (it keeps learning). */
export const EXPLORE_MIN_CAP_FRACTION = 0.02

/** Product default: "Not now" hides the shrink proposal for this many days. */
export const EXPLORE_SHRINK_SNOOZE_DAYS = 30

// ─── Automatic retirement (roadmap #4) ───────────────────────────────────────
// Switching a strategy off only ever REDUCES trading (paper_enabled = false;
// shadow tracking continues). It never changes a maturity status.

/** Product default: quarters with fewer closed trades than this are not judged by the benchmark rule. */
export const RETIRE_MIN_TRADES_PER_QUARTER = 5

/**
 * Product default: a strategy with at least the promotion minimum of closed
 * trades that FAILS its promotion gates (after-cost expectancy or drawdown)
 * on this many consecutive weekly reviews is switched off.
 */
export const RETIRE_FAIL_WEEKS = 8

/**
 * Product default: a strategy enabled this long that still hasn't produced the
 * promotion minimum of closed trades is switched off — it can't prove itself.
 */
export const RETIRE_EVIDENCE_DEADLINE_DAYS = 365

/**
 * Product default: the "edge beyond luck" gate's family-wise false-positive
 * rate. With many strategies under test, the bar per strategy is
 * alpha / (number of strategies) — a Bonferroni correction.
 */
export const LUCK_FAMILY_ALPHA = 0.05

// ─── AI committee cost and value (roadmap #7) ───────────────────────────────

/**
 * Product default: Anthropic first-party prices in USD per million tokens,
 * per model the app calls (plus current models, for a future switch). Cache
 * writes bill at CACHE_WRITE_MULTIPLIER × input, cache reads at
 * CACHE_READ_MULTIPLIER × input. Update when prices change.
 */
export const MODEL_PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':   { input: 5.00, output: 25.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5':  { input: 1.00, output: 5.00 },
  'claude-sonnet-5':   { input: 2.00, output: 10.00 },
  'claude-opus-4-8':   { input: 5.00, output: 25.00 },   // a server-side fallback target
  'claude-opus-5-5':   { input: 4.00, output: 20.00 },
  'claude-sonnet-5-5': { input: 2.00, output: 10.00 },
  'claude-haiku-5-5':  { input: 0.10, output: 0.50 },
}
export const CACHE_WRITE_MULTIPLIER = 1.25
export const CACHE_READ_MULTIPLIER = 0.10

/** Product default: a committee decision is graded on the price move this many days later. */
export const COMMITTEE_GRADE_HORIZON_DAYS = 5

/** Product default: the cost-and-value report looks back this many days. */
export const COMMITTEE_REVIEW_LOOKBACK_DAYS = 90

/** Product default: an agent needs this many graded vetoes (or votes) before a keep/cut verdict. */
export const COMMITTEE_MIN_GRADED_VETOES = 20

/**
 * Product default: agents whose "no" is a safety rule, not a vote — they can
 * never be turned off from the cost report.
 */
export const PROTECTED_COMMITTEE_AGENTS: readonly string[] = ['RiskManagementAgent']

// ─── Which Claude model does what (model switch) ─────────────────────────────

/** Product default: high-volume votes and quick checks (committee agents, Kronos, screener). */
export const AI_MODEL_FAST = 'claude-haiku-5-5'
/** Product default: mid-tier analysis (orchestrator, macro agent, prediction-market agent, research ideas). */
export const AI_MODEL_STANDARD = 'claude-sonnet-5-5'
/** Product default: the deepest reasoning (CIO synthesis, MiroFish simulation). */
export const AI_MODEL_DEEP = 'claude-opus-5-5'

/** Product default: effort for one-shot JSON votes and checks — Anthropic's advice for simple sub-agent tasks. */
export const AI_EFFORT_VOTE = 'low' as const
/** Product default: effort for synthesis, simulations and multistep tool use. */
export const AI_EFFORT_ANALYSIS = 'medium' as const

/**
 * Product default: reply cap for a vote. Thinking counts toward max_tokens on
 * the current models, so a cap sized for the JSON alone could cut the vote off.
 */
export const AI_VOTE_MAX_TOKENS = 4000

/**
 * Product default: models whose safety declines are retried server-side on
 * another model (Anthropic's recommended `fallbacks: "default"`). Haiku 5.5
 * has no server-side fallback; a decline there counts as an abstention.
 */
export const AI_FALLBACK_MODELS: readonly string[] = ['claude-opus-5-5', 'claude-sonnet-5-5']

/** Product default: Haiku 5.5's second rate card — prompts over 100K tokens bill at these rates. */
export const MODEL_LONG_PROMPT_PRICES: Record<string, { thresholdTokens: number; input: number; output: number }> = {
  'claude-haiku-5-5': { thresholdTokens: 100_000, input: 0.50, output: 2.50 },
}
