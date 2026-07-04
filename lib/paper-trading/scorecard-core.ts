/**
 * Paper scorecard core — pure math, no I/O. The loader in
 * lib/actions/paper-scorecard.ts gathers rows and delegates here so every
 * calculation is unit-testable.
 *
 * A scorecard exists for EVERY paper-enabled strategy — zero closed trades,
 * blocked-only, open-only, and missing-data strategies all get honest cards
 * instead of disappearing from the review.
 */

import { evaluatePaperToLive, type PromotionReadiness } from '@/lib/strategies/promotion-gates'
import type { StrategyAttribution } from './attribution'

// ─── Core trade math ──────────────────────────────────────────────────────────

export interface ClosedTrade {
  closedAt: string
  returnPct: number   // fraction
}

export interface ScorecardCore {
  closedTrades: number
  winRatePct: number | null
  expectancyPct: number | null
  avgWinPct: number | null
  avgLossPct: number | null
  maxDrawdownPct: number | null
  longestLossStreak: number
}

export function computeScorecardCore(trades: ClosedTrade[]): ScorecardCore {
  const sorted = [...trades].sort((a, b) => a.closedAt.localeCompare(b.closedAt))
  const n = sorted.length
  if (n === 0) {
    return {
      closedTrades: 0, winRatePct: null, expectancyPct: null,
      avgWinPct: null, avgLossPct: null, maxDrawdownPct: null, longestLossStreak: 0,
    }
  }

  const rets = sorted.map(t => t.returnPct)
  const wins = rets.filter(r => r > 0)
  const losses = rets.filter(r => r < 0)
  const mean = rets.reduce((s, r) => s + r, 0) / n

  let equity = 1, peak = 1, maxDd = 0
  let streak = 0, longestStreak = 0
  for (const r of rets) {
    equity *= 1 + r
    peak = Math.max(peak, equity)
    maxDd = Math.max(maxDd, (peak - equity) / peak)
    if (r < 0) {
      streak += 1
      longestStreak = Math.max(longestStreak, streak)
    } else {
      streak = 0
    }
  }

  const round = (v: number) => Math.round(v * 10_000) / 100
  return {
    closedTrades: n,
    winRatePct: round(wins.length / n),
    expectancyPct: round(mean),
    avgWinPct: wins.length ? round(wins.reduce((s, r) => s + r, 0) / wins.length) : null,
    avgLossPct: losses.length ? round(losses.reduce((s, r) => s + r, 0) / losses.length) : null,
    maxDrawdownPct: round(maxDd),
    longestLossStreak: longestStreak,
  }
}

/** Threshold-derived maturity recommendation — pure, no discretion. */
export function recommendMaturity(core: ScorecardCore, promotionReady: boolean): string {
  if (promotionReady) return 'promote to live_candidate — all promotion gates pass'
  if (core.closedTrades === 0) {
    return 'no evidence yet — needs closed paper trades before any recommendation'
  }
  if (core.closedTrades < 30) {
    return `continue paper_trading — ${core.closedTrades}/30 closed trades (insufficient sample)`
  }
  if ((core.expectancyPct ?? 0) <= 0) {
    return 'keep in paper_trading and review — negative expectancy after modeled costs'
  }
  if ((core.maxDrawdownPct ?? 0) > 15) {
    return 'keep in paper_trading at reduced size — drawdown above the 15% gate'
  }
  return 'continue paper_trading — positive expectancy, waiting on remaining promotion gates'
}

// ─── Modeled-cost transparency (item 8) ───────────────────────────────────────

export interface SlippageSummary {
  /** Mean modeled slippage on entry fills (bps). */
  entrySlippageBps: number | null
  /** Mean modeled slippage on exit fills (bps). */
  exitSlippageBps: number | null
  /** Round-trip modeled cost per trade, as a % of notional. */
  modeledRoundTripCostPct: number | null
  /** Expectancy BEFORE modeled slippage (reconstructed, not measured). */
  grossExpectancyPct: number | null
  /**
   * True when modeled slippage materially changes the verdict: it flips
   * the expectancy sign or eats more than half of the gross edge.
   */
  materialCostImpact: boolean
}

export function summarizeSlippage(args: {
  entrySlips: number[]
  exitSlips: number[]
  netExpectancyPct: number | null
}): SlippageSummary {
  const mean = (xs: number[]) => xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null
  const entry = mean(args.entrySlips)
  const exit = mean(args.exitSlips)
  const roundTripBps = (entry ?? 0) + (exit ?? 0)
  const roundTripPct = entry == null && exit == null ? null : roundTripBps / 100

  let gross: number | null = null
  let material = false
  if (args.netExpectancyPct != null && roundTripPct != null) {
    gross = Math.round((args.netExpectancyPct + roundTripPct) * 100) / 100
    // Sign flip, or cost consumes > 50% of the gross edge.
    material = (gross > 0 && args.netExpectancyPct <= 0) ||
      (gross > 0 && roundTripPct > gross * 0.5)
  }

  return {
    entrySlippageBps: entry != null ? Math.round(entry * 100) / 100 : null,
    exitSlippageBps: exit != null ? Math.round(exit * 100) / 100 : null,
    modeledRoundTripCostPct: roundTripPct != null ? Math.round(roundTripPct * 100) / 100 : null,
    grossExpectancyPct: gross,
    materialCostImpact: material,
  }
}

// ─── Activity counters from run history + audits ──────────────────────────────

export interface ActivityCounters {
  opportunitiesDetected: number
  paperFillsOpened: number
  paperExitsClosed: number
  openPositions: number
  skippedCount: number
  blockedCount: number
  riskVetoCount: number
  dataMissingCount: number
  lastRunAt: string | null
  lastTradeAt: string | null
}

/** Outcome strings that mean "risk machinery said no". */
const RISK_OUTCOMES = new Set(['riskBlocked', 'positionCapBlocked', 'liquidityBlocked', 'rejected_liquidity', 'block'])
/** Outcome strings that mean "we could not get data". */
const DATA_OUTCOMES = new Set(['missing_price', 'invalid_price', 'missingPrice', 'expiredMarket', 'resolvedMarket'])

export interface SkippedDetailRow {
  strategyKey: string
  outcome: string
}

export function countActivity(args: {
  skippedDetails: SkippedDetailRow[]
  auditBlocked: number
  auditVetoes: number
  fillsOpened: number
  exitsClosed: number
  openPositions: number
  lastRunAt: string | null
  lastTradeAt: string | null
}): ActivityCounters {
  let skipped = 0, blocked = 0, riskVeto = 0, dataMissing = 0
  for (const d of args.skippedDetails) {
    skipped += 1
    if (RISK_OUTCOMES.has(d.outcome)) { blocked += 1; riskVeto += 1 }
    else if (DATA_OUTCOMES.has(d.outcome)) dataMissing += 1
    else blocked += 1
  }
  return {
    // Lower bound: every fill and every recorded skip started as a detected
    // opportunity. Detections that produced neither are not persisted.
    opportunitiesDetected: args.fillsOpened + args.skippedDetails.length,
    paperFillsOpened: args.fillsOpened,
    paperExitsClosed: args.exitsClosed,
    openPositions: args.openPositions,
    skippedCount: skipped,
    blockedCount: blocked + args.auditBlocked,
    riskVetoCount: riskVeto + args.auditVetoes,
    dataMissingCount: dataMissing,
    lastRunAt: args.lastRunAt,
    lastTradeAt: args.lastTradeAt,
  }
}

// ─── Validation status ────────────────────────────────────────────────────────

export type ValidationStatus =
  | 'no_activity'      // never detected anything
  | 'missing_data'     // detections exist but data gaps dominate
  | 'blocked_only'     // detections exist, every one was blocked/skipped
  | 'open_only'        // has open positions, nothing closed yet
  | 'collecting'       // closed trades < 30
  | 'review_ready'     // ≥ 30 closed trades — evidence pack complete
  | 'promotion_ready'  // every promotion gate passes

export function deriveValidationStatus(
  core: ScorecardCore,
  activity: ActivityCounters,
  promotionReady: boolean
): ValidationStatus {
  if (promotionReady) return 'promotion_ready'
  if (core.closedTrades >= 30) return 'review_ready'
  if (core.closedTrades > 0) return 'collecting'
  if (activity.openPositions > 0) return 'open_only'
  if (activity.opportunitiesDetected === 0) return 'no_activity'
  if (activity.dataMissingCount > 0 && activity.dataMissingCount >= activity.blockedCount) return 'missing_data'
  return 'blocked_only'
}

// ─── Full scorecard assembly ──────────────────────────────────────────────────

export interface PaperScorecard extends ScorecardCore, ActivityCounters, SlippageSummary {
  strategyKey: string
  assetClass: string
  paperEnabled: boolean
  promotion: PromotionReadiness
  maturityRecommendation: string
  validationStatus: ValidationStatus
  /** Attribution decomposition (item 7) — attached by the loader when computed. */
  attribution?: StrategyAttribution
}

export interface ScorecardInputs {
  strategyKey: string
  assetClass: string
  paperEnabled: boolean
  closedTrades: ClosedTrade[]
  entrySlips: number[]
  exitSlips: number[]
  skippedDetails: SkippedDetailRow[]
  auditBlocked: number
  auditVetoes: number
  fillsOpened: number
  exitsClosed: number
  openPositions: number
  lastRunAt: string | null
  lastTradeAt: string | null
  rollingBrier: number | null
  shadowAvgReturnPct: number | null
  closedShadowTrades: number
}

export function assembleScorecard(inputs: ScorecardInputs): PaperScorecard {
  const core = computeScorecardCore(inputs.closedTrades)
  const slippage = summarizeSlippage({
    entrySlips: inputs.entrySlips,
    exitSlips: inputs.exitSlips,
    netExpectancyPct: core.expectancyPct,
  })
  const activity = countActivity(inputs)
  const promotion = evaluatePaperToLive(
    inputs.strategyKey,
    {
      closedTrades: core.closedTrades,
      avgReturnPct: core.expectancyPct != null ? core.expectancyPct / 100 : null,
      maxDrawdownPct: core.maxDrawdownPct != null ? core.maxDrawdownPct / 100 : null,
      assetClass: inputs.assetClass,
    },
    inputs.rollingBrier,
    { shadowAvgReturnPct: inputs.shadowAvgReturnPct, closedShadowTrades: inputs.closedShadowTrades }
  )

  return {
    strategyKey: inputs.strategyKey,
    assetClass: inputs.assetClass,
    paperEnabled: inputs.paperEnabled,
    ...core,
    ...activity,
    ...slippage,
    promotion,
    maturityRecommendation: recommendMaturity(core, promotion.ready),
    validationStatus: deriveValidationStatus(core, activity, promotion.ready),
  }
}
