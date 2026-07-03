/**
 * Shared empirical-Kelly sizing path — the ONLY way positions get sized.
 *
 * Replaces the strength-as-probability Kelly that was copied across the
 * orchestrator, BasePipelineStrategy.runRiskCheck, and a dozen impls:
 * `strength` is a signal heuristic (e.g. min(1, m/0.1)), not a calibrated
 * probability, so noisy signals maxed out sizing every time.
 *
 * Win probability comes from the strategy's OWN rolling calibration
 * (lib/learning/rolling-brier.ts — empirical win rate over the last 20 graded
 * outcomes). With no history the strategy sizes at a fixed maturity-floor
 * probe: UNCALIBRATED_PROBE_FRACTION × maturity haircut — never at strength.
 *
 * Equity is REAL account equity via getPortfolioUsd(). If it cannot be
 * fetched the answer is 0 with an audit log — never a $10k default.
 *
 * Quarter-Kelly scaling (risk-controls.quarterKelly) and the 10% per-position
 * cap are preserved. empiricalKelly() then applies maturity/Brier haircuts —
 * haircuts only ever reduce size.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { quarterKelly, getPortfolioUsd } from '@/lib/strategies/risk-controls'
import { empiricalKelly } from '@/lib/strategies/empirical-kelly'
import { getStrategyConfig, isStrategyKey } from '@/lib/strategies/strategy-registry'
import { getRollingBrier } from '@/lib/learning/rolling-brier'
import type { Opportunity, PositionSize } from '@/lib/strategies/pipeline-types'

/** Quarter-Kelly-equivalent probe fraction for a strategy with no calibration
 *  history, BEFORE the maturity haircut. backtest_ready → 0.2%, paper → 1%. */
export const UNCALIBRATED_PROBE_FRACTION = 0.02

/** Hard per-position cap as fraction of equity. */
export const MAX_POSITION_FRACTION = 0.10

export interface EmpiricalSizeResult {
  /** Final fraction of equity [0, MAX_POSITION_FRACTION]. 0 = do not trade. */
  fraction: number
  /** Real account equity, or null when it could not be established. */
  portfolioUsd: number | null
  notionalUsd: number
  winProb: number | null
  winProbSource: 'calibration' | 'maturity_floor'
  brierScore: number | null
  /** True when maturity or missing equity forbids trading entirely. */
  blocked: boolean
  reason?: string
  rationale: string
}

function blockedResult(reason: string): EmpiricalSizeResult {
  return {
    fraction: 0,
    portfolioUsd: null,
    notionalUsd: 0,
    winProb: null,
    winProbSource: 'maturity_floor',
    brierScore: null,
    blocked: true,
    reason,
    rationale: reason,
  }
}

/** Win/loss payoff ratio from the opportunity's bracket, clamped to sane range. */
export function winLossRatioFor(opp: Pick<Opportunity, 'bracket'>): number {
  const tp = opp.bracket?.takeProfitPct
  const sl = opp.bracket?.stopLossPct
  if (tp != null && sl != null && sl > 0 && Number.isFinite(tp / sl)) {
    return Math.min(5, Math.max(0.5, tp / sl))
  }
  return 1.5
}

export async function computeEmpiricalSize(opts: {
  supabase: SupabaseClient | undefined
  userId: string
  strategyKey: string
  opp: Pick<Opportunity, 'bracket' | 'symbol'>
  /** Strategy-specific cap (fraction); the 10% hard cap still applies. */
  capFraction?: number
  /**
   * A REAL probability estimate from the strategy's own model (e.g. market-
   * implied P(win) on a binary) — NOT signal strength. Used only when no
   * rolling calibration exists yet; calibration always wins once present.
   */
  modelWinProb?: number
  /** Payoff ratio override to pair with modelWinProb. */
  winLossRatio?: number
}): Promise<EmpiricalSizeResult> {
  const { supabase, userId, strategyKey, opp } = opts
  const cap = Math.min(opts.capFraction ?? MAX_POSITION_FRACTION, MAX_POSITION_FRACTION)

  if (!isStrategyKey(strategyKey)) {
    return blockedResult(`unknown_strategy_key: ${strategyKey} — refusing to size`)
  }
  const maturity = getStrategyConfig(strategyKey).maturityStatus

  // ── Real equity, or refuse ─────────────────────────────────────────────────
  const portfolioUsd = supabase ? await getPortfolioUsd(supabase, userId) : null
  if (portfolioUsd == null) {
    const result = blockedResult('equity_unavailable: refusing to size — never default equity')
    if (supabase) {
      // Audit the refusal so it is visible, not silently dropped.
      try {
        await supabase.from('audit_logs').insert({
          user_id: userId,
          strategy_key: strategyKey,
          symbol: opp.symbol,
          decision: 'block',
          size_fraction: 0,
          mirofish_used: false,
          kronos_used: false,
          decided_at: new Date().toISOString(),
          metadata: { blocked_by: 'empirical_sizing', reason: result.reason },
        })
      } catch (err) {
        console.warn('[empirical-sizing] audit insert failed:', err)
      }
    }
    console.warn(`[empirical-sizing] ${strategyKey} ${opp.symbol}: ${result.reason}`)
    return result
  }

  // ── Rolling calibration → win probability (never signal strength) ─────────
  const calibration = supabase ? await getRollingBrier(supabase, strategyKey).catch(() => null) : null
  const winRate = calibration?.winRate ?? null

  let rawKelly: number
  let winProb: number | null
  let winProbSource: EmpiricalSizeResult['winProbSource']
  if (winRate != null) {
    winProb = Math.min(0.95, Math.max(0.05, winRate))
    winProbSource = 'calibration'
    rawKelly = quarterKelly(winProb, opts.winLossRatio ?? winLossRatioFor(opp))
  } else if (opts.modelWinProb != null && Number.isFinite(opts.modelWinProb)) {
    // Strategy supplied a real probability model (not strength) — usable
    // until calibration accumulates, still subject to maturity haircuts.
    winProb = Math.min(0.95, Math.max(0.05, opts.modelWinProb))
    winProbSource = 'maturity_floor'
    rawKelly = Math.min(
      quarterKelly(winProb, opts.winLossRatio ?? winLossRatioFor(opp)),
      UNCALIBRATED_PROBE_FRACTION * 2  // model estimates don't get unbounded trust
    )
  } else {
    // No calibration history → fixed maturity-floor probe, NOT strength.
    winProb = null
    winProbSource = 'maturity_floor'
    rawKelly = UNCALIBRATED_PROBE_FRACTION
  }

  const ek = empiricalKelly({
    kellyFraction: rawKelly,
    maturityStatus: maturity,
    brierScore: calibration?.brierScore,
  })
  if (ek.blocked) {
    return {
      ...blockedResult(`maturity_blocked: ${maturity} strategies must never execute`),
      portfolioUsd,
    }
  }

  const fraction = Math.min(cap, Math.max(0, ek.fraction))
  const notionalUsd = fraction * portfolioUsd

  const rationale = winProbSource === 'calibration'
    ? `empirical Kelly: winRate=${(winProb! * 100).toFixed(0)}% (n=${calibration?.sampleCount}), ` +
      `brier=${calibration?.brierScore?.toFixed(3)}, maturity=${maturity} → ${(fraction * 100).toFixed(2)}%`
    : `uncalibrated probe: ${(UNCALIBRATED_PROBE_FRACTION * 100).toFixed(0)}% × maturity(${maturity}) → ${(fraction * 100).toFixed(2)}%`

  return {
    fraction,
    portfolioUsd,
    notionalUsd,
    winProb,
    winProbSource,
    brierScore: calibration?.brierScore ?? null,
    blocked: false,
    rationale,
  }
}

/** Zero-size PositionSize for refusal paths. */
export function zeroSize(reason: string): PositionSize {
  return { fraction: 0, notionalUsd: 0, rationale: reason }
}

/**
 * For strategies with STRUCTURAL sizing (arb legs, spread-based fractions):
 * routes their computed fraction through empiricalKelly so maturity and
 * calibration haircuts still apply. Haircuts only ever reduce the fraction.
 */
export async function applyEmpiricalHaircuts(
  fraction: number,
  opts: { supabase: SupabaseClient | undefined; strategyKey: string }
): Promise<{ fraction: number; blocked: boolean; reason?: string }> {
  if (!isStrategyKey(opts.strategyKey)) {
    return { fraction: 0, blocked: true, reason: `unknown_strategy_key: ${opts.strategyKey}` }
  }
  const maturity = getStrategyConfig(opts.strategyKey).maturityStatus
  const calibration = opts.supabase
    ? await getRollingBrier(opts.supabase, opts.strategyKey).catch(() => null)
    : null
  const ek = empiricalKelly({
    kellyFraction: Math.max(0, fraction),
    maturityStatus: maturity,
    brierScore: calibration?.brierScore,
  })
  if (ek.blocked) {
    return { fraction: 0, blocked: true, reason: `maturity_blocked: ${maturity} strategies must never execute` }
  }
  return { fraction: Math.min(ek.fraction, MAX_POSITION_FRACTION), blocked: false }
}
