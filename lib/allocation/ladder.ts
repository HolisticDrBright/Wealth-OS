/**
 * The three-tier ladder (Phase 2) — PURE. A person's money is filled in order:
 *
 *   Tier 1 Safety   cash-like only. Emergency fund (EMERGENCY_FUND_MONTHS ×
 *                   monthly essential expenses) plus the FULL target of every
 *                   goal due within SHORT_HORIZON_YEARS.
 *   Tier 2 Core     the diversified fund mix; its stock/bond split comes from
 *                   the glide path (lib/allocation/policy.ts).
 *   Tier 3 Explore  the existing Explore sleeve and cap — except the cap is
 *                   computed on money NOT in Tier 1, and Explore is ZERO until
 *                   Tier 1 is fully funded (owner decision: strict).
 *
 * "Funded" is holdings-level: cash-like holdings (recorded cash assets plus
 * any Tier 1 money designated by an approved "Set up your ladder" decision)
 * must reach the target. Missing monthly expenses = target unknown = not
 * funded, with a plain-English reason.
 */

import {
  EMERGENCY_FUND_MONTHS, CASH_LIKE_CATEGORIES, LADDER_EXCLUDED_CATEGORIES,
} from '@/lib/config/product-defaults'
import type { CoreFundSlot } from '@/lib/allocation/policy'
import {
  yearsUntil, isShortHorizon, coreStockShare, coreFundsForStockShare,
  clampExploreCapFraction,
} from '@/lib/allocation/policy'

export interface LadderGoal {
  id: string
  name: string
  targetAmountUsd: number
  targetDate: string | null
}

export interface LadderInput {
  assets: Array<{ category: string; current_value: number | null }>
  /** Essential monthly expenses; null = not entered yet. */
  monthlyExpensesUsd: number | null
  goals: LadderGoal[]
  profileKey: string | null
  /** The Explore sleeve's cap fraction (unclamped user value; null = default). */
  exploreCapFraction: number | null
  /** Tier 1 money designated by an approved "Set up your ladder" decision. */
  tier1DesignatedUsd: number
  /** Open strategy + copy notional (Explore in use). */
  exploreInUseUsd: number
  /** Paper Core / Safety holdings (Phase 3). Omitted = none yet. */
  holdings?: LadderHoldings
  /** Total practice-money deposits (Phase 3). */
  depositsUsd?: number
  now?: Date
}

/** Market value of the paper Core / Safety positions (lib/allocation/core-trading.ts). */
export interface LadderHoldings {
  /** Tier 1 Safety cash-like fund positions, at market. */
  safetyUsd: number
  /** Core fund positions at market, by symbol. */
  coreBySymbol: Record<string, number>
  /** Realized + unrealized P&L on all Core / Safety rows. */
  ladderPnlUsd: number
  /** True once any Core fund position has been bought. */
  hasCorePositions: boolean
}

export const NO_HOLDINGS: LadderHoldings = { safetyUsd: 0, coreBySymbol: {}, ladderPnlUsd: 0, hasCorePositions: false }

export interface CoreFundView {
  slot: CoreFundSlot
  symbol: string
  assetClass: 'stock' | 'bond' | 'cash'
  /** Target weight within Core (0–1). */
  weight: number
  targetUsd: number
  heldUsd: number
}

export type Tier1Status = 'funded' | 'short' | 'needs_expenses'

export interface Ladder {
  /** Market value: recorded money + deposits + Core/Safety P&L (excl. real estate). */
  investableUsd: number
  /** Book value: recorded money + deposits, no P&L. The Explore cap is measured on this. */
  fundingUsd: number
  /** Practice-money deposits included in fundingUsd. */
  depositsUsd: number
  /** Realized + unrealized P&L of the paper Core / Safety positions. */
  ladderPnlUsd: number
  /** Market money NOT in a Core / Safety fund position (recorded cash, other assets, Explore room). */
  unplacedUsd: number
  tier1: {
    status: Tier1Status
    funded: boolean
    /** Null when monthly expenses are unknown. */
    targetUsd: number | null
    emergencyUsd: number | null
    shortGoalsUsd: number
    shortGoals: Array<{ name: string; targetAmountUsd: number; targetDate: string | null }>
    /**
     * Cash-like money held: the cash-like fund position, plus recorded cash and
     * any approved designation that haven't been spent on Core funds.
     */
    heldUsd: number
    /** The part of heldUsd that is the cash-like fund position itself. */
    inFundUsd: number
    /** The part of investable money that IS Tier 1 = min(held, target). */
    amountUsd: number
    shortfallUsd: number
    /** Plain English, for Simple mode. */
    reason: string | null
  }
  core: {
    /** What Core should hold: (investable − Tier 1 target) × (1 − Explore share). */
    targetUsd: number
    /** What paper Core positions hold, at market. */
    heldUsd: number
    /** False until Core funds have actually been bought. */
    invested: boolean
    stockShare: number
    bondShare: number
    funds: CoreFundView[]
  }
  explore: {
    capFraction: number
    /** Money the cap is measured against: investable minus Tier 1. */
    baseUsd: number
    capUsd: number
    inUseUsd: number
    leftUsd: number
    open: boolean
    /** Plain English, for Simple mode, when Explore is closed. */
    reason: string | null
  }
}

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const round2 = (n: number) => Math.round(n * 100) / 100

export function computeLadder(input: LadderInput): Ladder {
  const now = input.now ?? new Date()

  const holdings = input.holdings ?? NO_HOLDINGS

  // Book value: every recorded asset except excluded categories, plus deposits.
  let fundingUsd = Math.max(0, input.depositsUsd ?? 0)
  let cashAssetsUsd = 0
  for (const a of input.assets) {
    const v = Math.max(0, a.current_value ?? 0)
    if (LADDER_EXCLUDED_CATEGORIES.includes(a.category)) continue
    fundingUsd += v
    if (CASH_LIKE_CATEGORIES.includes(a.category)) cashAssetsUsd += v
  }
  // Market value: Core / Safety holdings move with their funds.
  const investableUsd = Math.max(0, fundingUsd + holdings.ladderPnlUsd)

  // Tier 1 target.
  const shortGoals = input.goals.filter(g => isShortHorizon(yearsUntil(g.targetDate, now)))
  const shortGoalsUsd = shortGoals.reduce((s, g) => s + Math.max(0, g.targetAmountUsd), 0)
  const expenses = input.monthlyExpensesUsd
  const emergencyUsd = expenses != null && Number.isFinite(expenses) && expenses >= 0
    ? EMERGENCY_FUND_MONTHS * expenses
    : null
  const targetUsd = emergencyUsd == null ? null : emergencyUsd + shortGoalsUsd

  // Fund positions are bought with the person's recorded money, so that money
  // must not be counted twice. Money outside fund positions is "unplaced";
  // purchases are assumed to use non-cash money first, so recorded cash (and
  // any Phase 2 designation) only counts toward Tier 1 while it is unplaced.
  const safetyInFundUsd = Math.max(0, holdings.safetyUsd)
  const coreHeldUsd = Object.values(holdings.coreBySymbol).reduce((s, v) => s + Math.max(0, v), 0)
  const unplacedUsd = Math.max(0, investableUsd - safetyInFundUsd - coreHeldUsd)
  const cashCountedUsd = Math.min(unplacedUsd, cashAssetsUsd + Math.max(0, input.tier1DesignatedUsd))
  const heldUsd = Math.min(investableUsd, cashCountedUsd + safetyInFundUsd)

  let status: Tier1Status
  let reason: string | null = null
  if (targetUsd == null) {
    status = 'needs_expenses'
    reason = 'Add your monthly expenses so we can size your safety cushion. Explore stays at $0 until it is full.'
  } else if (heldUsd + 0.005 >= targetUsd) {
    status = 'funded'
  } else {
    status = 'short'
    reason = `Your safety cushion has ${usd(heldUsd)} of the ${usd(targetUsd)} it needs. Explore stays at $0 until it is full.`
  }
  const funded = status === 'funded'
  const amountUsd = targetUsd == null ? Math.min(heldUsd, 0) : Math.min(heldUsd, targetUsd)
  const shortfallUsd = targetUsd == null ? 0 : Math.max(0, targetUsd - heldUsd)

  // Tier 3 Explore: cap measured on BOOK money not in Tier 1 (never on Core
  // market gains, so it can't grow from them); zero until Tier 1 is funded.
  const capFraction = clampExploreCapFraction(input.exploreCapFraction)
  const baseUsd = Math.max(0, fundingUsd - amountUsd)
  const capUsd = funded ? capFraction * baseUsd : 0
  const inUseUsd = Math.max(0, input.exploreInUseUsd)

  // Tier 2 Core: everything not in Tier 1 or in use by Explore.
  const stockShare = coreStockShare(
    input.goals.map(g => ({ targetAmountUsd: g.targetAmountUsd, targetDate: g.targetDate })),
    input.profileKey, now,
  )
  // Core target: what's left after the FULL Tier 1 target and the Explore
  // reserve, at market (so a short Tier 1 never inflates Core's target).
  const tier1ReserveUsd = targetUsd == null ? amountUsd : Math.min(targetUsd, investableUsd)
  const coreTargetUsd = Math.max(0, (investableUsd - tier1ReserveUsd) * (1 - capFraction))
  const fundViews: CoreFundView[] = coreFundsForStockShare(stockShare).map(f => ({
    slot: f.slot, symbol: f.symbol, assetClass: f.assetClass, weight: f.weight,
    targetUsd: round2(coreTargetUsd * f.weight),
    heldUsd: round2(Math.max(0, holdings.coreBySymbol[f.symbol] ?? 0)),
  }))

  return {
    investableUsd: round2(investableUsd),
    fundingUsd: round2(fundingUsd),
    depositsUsd: round2(Math.max(0, input.depositsUsd ?? 0)),
    ladderPnlUsd: round2(holdings.ladderPnlUsd),
    unplacedUsd: round2(unplacedUsd),
    tier1: {
      status, funded,
      targetUsd: targetUsd == null ? null : round2(targetUsd),
      emergencyUsd: emergencyUsd == null ? null : round2(emergencyUsd),
      shortGoalsUsd: round2(shortGoalsUsd),
      shortGoals: shortGoals.map(g => ({ name: g.name, targetAmountUsd: g.targetAmountUsd, targetDate: g.targetDate })),
      heldUsd: round2(heldUsd),
      inFundUsd: round2(safetyInFundUsd),
      amountUsd: round2(amountUsd),
      shortfallUsd: round2(shortfallUsd),
      reason,
    },
    core: {
      targetUsd: round2(coreTargetUsd),
      heldUsd: round2(coreHeldUsd),
      invested: holdings.hasCorePositions,
      stockShare,
      bondShare: 1 - stockShare,
      funds: fundViews,
    },
    explore: {
      capFraction,
      baseUsd: round2(baseUsd),
      capUsd: round2(capUsd),
      inUseUsd: round2(inUseUsd),
      leftUsd: round2(Math.max(0, capUsd - inUseUsd)),
      open: funded,
      reason: funded ? null : reason,
    },
  }
}

/**
 * Money that is neither in a fund position nor counted as Tier 1 cash — what
 * the setup can move into Tier 1 or Core without double counting.
 */
export function freeUsd(ladder: Ladder): number {
  const cashCounted = Math.max(0, ladder.tier1.heldUsd - ladder.tier1.inFundUsd)
  return round2(Math.max(0, ladder.unplacedUsd - cashCounted))
}

/**
 * How much existing (non-cash) money an approved "Set up your ladder" decision
 * would move into Tier 1: the shortfall, bounded by what is free.
 */
export function ladderSetupAmount(ladder: Ladder): number {
  if (ladder.tier1.status !== 'short') return 0
  return round2(Math.min(ladder.tier1.shortfallUsd, freeUsd(ladder)))
}
