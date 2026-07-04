/**
 * Strategy coverage report (validation item 7) — answers, from the
 * scorecards, which strategies are actually participating in the paper
 * phase and which are dead weight:
 *
 *   enabled / detecting / trading / never-traded / blocked-by-missing-data /
 *   blocked-by-risk-cost-confluence / evidence-ready-for-review
 *
 * Pure function over PaperScorecard[] so the dashboard and tests share it.
 */

import type { PaperScorecard } from './scorecard-core'

export interface CoverageEntry {
  strategyKey: string
  assetClass: string
  validationStatus: PaperScorecard['validationStatus']
  detail: string
}

export interface StrategyCoverageReport {
  /** Paper-enabled strategy count vs total cards. */
  enabledCount: number
  totalCount: number
  /** Detected ≥1 opportunity during the window. */
  detecting: CoverageEntry[]
  /** Opened ≥1 paper fill. */
  trading: CoverageEntry[]
  /** Enabled but never opened a paper trade. */
  neverTraded: CoverageEntry[]
  /** Detections dominated by missing market data. */
  blockedByMissingData: CoverageEntry[]
  /** Every detection died at risk / cost / confluence gates. */
  blockedByRisk: CoverageEntry[]
  /** ≥30 closed trades — the evidence pack is reviewable. */
  reviewReady: CoverageEntry[]
  /** Enabled with zero recorded activity at all. */
  silent: CoverageEntry[]
}

function entry(s: PaperScorecard, detail: string): CoverageEntry {
  return {
    strategyKey: s.strategyKey,
    assetClass: s.assetClass,
    validationStatus: s.validationStatus,
    detail,
  }
}

export function buildCoverageReport(scorecards: PaperScorecard[]): StrategyCoverageReport {
  const enabled = scorecards.filter(s => s.paperEnabled)

  const detecting = scorecards
    .filter(s => s.opportunitiesDetected > 0)
    .map(s => entry(s, `${s.opportunitiesDetected} opportunit${s.opportunitiesDetected === 1 ? 'y' : 'ies'} recorded`))

  const trading = scorecards
    .filter(s => s.paperFillsOpened > 0)
    .map(s => entry(s, `${s.paperFillsOpened} fill(s), ${s.closedTrades} closed`))

  const neverTraded = enabled
    .filter(s => s.paperFillsOpened === 0 && s.openPositions === 0 && s.closedTrades === 0)
    .map(s => entry(s, s.opportunitiesDetected > 0
      ? `detected ${s.opportunitiesDetected} but never filled (${s.blockedCount} blocked, ${s.dataMissingCount} data-missing)`
      : 'no recorded activity'))

  const blockedByMissingData = scorecards
    .filter(s => s.validationStatus === 'missing_data')
    .map(s => entry(s, `${s.dataMissingCount} detections lost to missing/invalid market data`))

  const blockedByRisk = scorecards
    .filter(s => s.validationStatus === 'blocked_only' && s.riskVetoCount + s.blockedCount > 0)
    .map(s => entry(s, `${s.blockedCount} blocked (${s.riskVetoCount} risk vetoes) — zero fills`))

  const reviewReady = scorecards
    .filter(s => s.validationStatus === 'review_ready' || s.validationStatus === 'promotion_ready')
    .map(s => entry(s, `${s.closedTrades} closed trades — ${s.validationStatus === 'promotion_ready' ? 'ALL promotion gates pass' : 'evidence pack complete'}`))

  const silent = enabled
    .filter(s => s.validationStatus === 'no_activity')
    .map(s => entry(s, 'enabled but produced no detections, fills, or blocks in the window'))

  return {
    enabledCount: enabled.length,
    totalCount: scorecards.length,
    detecting,
    trading,
    neverTraded,
    blockedByMissingData,
    blockedByRisk,
    reviewReady,
    silent,
  }
}
