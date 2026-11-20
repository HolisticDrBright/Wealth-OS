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
import {
  yearsUntil, isShortHorizon, coreStockShare, coreFundsForStockShare,
  clampExploreCapFraction, type FundTarget,
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
  now?: Date
}

export type Tier1Status = 'funded' | 'short' | 'needs_expenses'

export interface Ladder {
  investableUsd: number
  tier1: {
    status: Tier1Status
    funded: boolean
    /** Null when monthly expenses are unknown. */
    targetUsd: number | null
    emergencyUsd: number | null
    shortGoalsUsd: number
    shortGoals: Array<{ name: string; targetAmountUsd: number; targetDate: string | null }>
    /** Cash-like money held (recorded cash + approved designation), capped at investable. */
    heldUsd: number
    /** The part of investable money that IS Tier 1 = min(held, target). */
    amountUsd: number
    shortfallUsd: number
    /** Plain English, for Simple mode. */
    reason: string | null
  }
  core: {
    amountUsd: number
    stockShare: number
    bondShare: number
    funds: FundTarget[]
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

  // Investable money: every recorded asset except excluded categories.
  let investableUsd = 0
  let cashAssetsUsd = 0
  for (const a of input.assets) {
    const v = Math.max(0, a.current_value ?? 0)
    if (LADDER_EXCLUDED_CATEGORIES.includes(a.category)) continue
    investableUsd += v
    if (CASH_LIKE_CATEGORIES.includes(a.category)) cashAssetsUsd += v
  }

  // Tier 1 target.
  const shortGoals = input.goals.filter(g => isShortHorizon(yearsUntil(g.targetDate, now)))
  const shortGoalsUsd = shortGoals.reduce((s, g) => s + Math.max(0, g.targetAmountUsd), 0)
  const expenses = input.monthlyExpensesUsd
  const emergencyUsd = expenses != null && Number.isFinite(expenses) && expenses >= 0
    ? EMERGENCY_FUND_MONTHS * expenses
    : null
  const targetUsd = emergencyUsd == null ? null : emergencyUsd + shortGoalsUsd

  const heldUsd = Math.min(investableUsd, cashAssetsUsd + Math.max(0, input.tier1DesignatedUsd))

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

  // Tier 3 Explore: cap measured on money not in Tier 1; zero until funded.
  const capFraction = clampExploreCapFraction(input.exploreCapFraction)
  const baseUsd = Math.max(0, investableUsd - amountUsd)
  const capUsd = funded ? capFraction * baseUsd : 0
  const inUseUsd = Math.max(0, input.exploreInUseUsd)

  // Tier 2 Core: everything not in Tier 1 or in use by Explore.
  const stockShare = coreStockShare(
    input.goals.map(g => ({ targetAmountUsd: g.targetAmountUsd, targetDate: g.targetDate })),
    input.profileKey, now,
  )
  const coreAmountUsd = Math.max(0, investableUsd - amountUsd - inUseUsd)

  return {
    investableUsd: round2(investableUsd),
    tier1: {
      status, funded,
      targetUsd: targetUsd == null ? null : round2(targetUsd),
      emergencyUsd: emergencyUsd == null ? null : round2(emergencyUsd),
      shortGoalsUsd: round2(shortGoalsUsd),
      shortGoals: shortGoals.map(g => ({ name: g.name, targetAmountUsd: g.targetAmountUsd, targetDate: g.targetDate })),
      heldUsd: round2(heldUsd),
      amountUsd: round2(amountUsd),
      shortfallUsd: round2(shortfallUsd),
      reason,
    },
    core: {
      amountUsd: round2(coreAmountUsd),
      stockShare,
      bondShare: 1 - stockShare,
      funds: coreFundsForStockShare(stockShare),
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
 * How much existing (non-cash) money an approved "Set up your ladder" decision
 * would move into Tier 1: the shortfall, bounded by what is available.
 */
export function ladderSetupAmount(ladder: Ladder): number {
  if (ladder.tier1.status !== 'short') return 0
  const available = Math.max(0, ladder.investableUsd - ladder.tier1.heldUsd)
  return round2(Math.min(ladder.tier1.shortfallUsd, available))
}
