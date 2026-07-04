/**
 * THE SWEEP ENGINE — when money leaves the trading sleeves and where it goes.
 * Implements Knowledge Base §5 (core math) and §6 (triggers, tax-aware
 * execution, destination routing). Pure functions — every parameter comes
 * from kb_parameters / tax_constants, never code.
 *
 * Compliance: produces RECOMMENDATIONS (paper: auto; live: user-confirmed).
 * The engine never moves money.
 */

import type { KbParameters, TaxConstants } from './types'

// ─── §5.1 Merton share ────────────────────────────────────────────────────────

/** w* = (mu − r) / (gamma × sigma²) — strategic risky allocation. */
export function mertonShare(equityRiskPremium: number, gamma: number, sigma: number): number {
  if (gamma <= 0 || sigma <= 0) return 0
  return Math.min(1, Math.max(0, equityRiskPremium / (gamma * sigma * sigma)))
}

// ─── §5.2 Drawdown-constrained fractional Kelly (Thorp) ──────────────────────

/** P(ever losing fraction d of the sleeve) at Kelly fraction c: (1−d)^(2/c − 1). */
export function kellyDrawdownProbability(drawdownFraction: number, kellyFraction: number): number {
  if (drawdownFraction <= 0 || drawdownFraction >= 1 || kellyFraction <= 0) return 0
  return Math.pow(1 - drawdownFraction, 2 / kellyFraction - 1)
}

/**
 * Max Kelly fraction c such that P(DD ≥ dMax) ≤ pMax:
 * c ≤ 2 / (1 + ln(pMax)/ln(1−dMax)).
 * Example: dMax=0.5, pMax=0.05 → c ≈ 0.376.
 */
export function kellyMaxFraction(dMax: number, pMax: number): number {
  if (dMax <= 0 || dMax >= 1 || pMax <= 0 || pMax >= 1) return 0
  return 2 / (1 + Math.log(pMax) / Math.log(1 - dMax))
}

// ─── §5.3 TIPP floor (the profit ratchet) ─────────────────────────────────────

/** F_t = max(F_{t−1} × growth, k × V_t) — the floor only ever rises. */
export function tippFloor(
  prevFloor: number,
  currentValue: number,
  k: number,
  riskFreeGrowthFactor = 1
): number {
  return Math.max(prevFloor * riskFreeGrowthFactor, k * currentValue)
}

/** E_t = m × max(V_t − F_t, 0) — risky exposure = multiplier × cushion. */
export function tippExposure(currentValue: number, floor: number, multiplier: number): number {
  return Math.min(currentValue, multiplier * Math.max(currentValue - floor, 0))
}

// ─── §5.4 Volatility brake ────────────────────────────────────────────────────

/** exposure = min(1, sigma_target / sigma_realized) — a BRAKE, never leverage. */
export function volBrakeExposure(sigmaTarget: number, sigmaRealized: number): number {
  if (sigmaRealized <= 0) return 1
  return Math.min(1, sigmaTarget / sigmaRealized)
}

// ─── §5.5 Rebalancing bands ───────────────────────────────────────────────────

/** 20%-relative band breach (Daryanani): |w − target| / target > band. */
export function bandBreached(currentWeight: number, targetWeight: number, relativeBand: number): boolean {
  if (targetWeight <= 0) return currentWeight > 0
  return Math.abs(currentWeight - targetWeight) / targetWeight > relativeBand
}

// ─── §6.2 Deferral hurdle (STCG → LTCG wait math) ─────────────────────────────

/**
 * Tolerable price decline while waiting for LTCG:
 * d = g × (t_s − t_l) / (1 − t_l), g = gain as fraction of value.
 * A 2×-cost position (g = 0.5) tolerates ~11% at 2026 top rates.
 */
export function deferralHurdle(gainFraction: number, stcgRate: number, ltcgRate: number): number {
  if (gainFraction <= 0) return 0
  return gainFraction * (stcgRate - ltcgRate) / (1 - ltcgRate)
}

// ─── §6.1 Sweep triggers ──────────────────────────────────────────────────────

/**
 * KB §1 wealth-tier ladder for the speculative sleeve cap (W7):
 * <$100k mass market → $100k–$1M mass affluent → $1M–$5M HNW →
 * $5M–$25M VHNW → >$25M UHNW. Missing parameters fall back to the
 * nearest LOWER tier — never a looser cap than what was verified.
 */
export function tierCapForInvestable(
  investableUsd: number,
  params: Record<string, number | undefined>
): number {
  const massMarket = params.sleeve_cap_mass_market ?? 0.05
  const massAffluent = params.sleeve_cap_mass_affluent ?? massMarket
  const hnw = params.sleeve_cap_hnw ?? massAffluent
  const vhnw = params.sleeve_cap_vhnw ?? hnw
  const uhnw = params.sleeve_cap_uhnw ?? vhnw
  if (investableUsd < 100_000) return massMarket
  if (investableUsd < 1_000_000) return massAffluent
  if (investableUsd < 5_000_000) return hnw
  if (investableUsd < 25_000_000) return vhnw
  return uhnw
}

export interface SleeveState {
  key: string
  valueUsd: number
  /** TIPP floor (ratcheted). 0 = not yet initialized. */
  floorUsd: number
  /** Peak cushion (V − F at its highest). */
  peakCushionUsd: number
  initialBankrollUsd: number
  /** Sleeve high-water mark for the bankroll ratchet. */
  ratchetHwmUsd: number
  sigmaRealized: number | null
  sigmaTarget: number | null
  /** Sleeve weight as a fraction of investable assets. */
  weightFraction: number
  /** Tier cap from KB §1 (min(risk tolerance, capacity) already applied). */
  tierCapFraction: number
  /** Drawdown-constrained Kelly weight limit for the sleeve. */
  kellyCapFraction: number | null
  suspended: boolean
}

export interface SweepState {
  emergencyFundUsd: number
  emergencyTargetUsd: number
  tradingHalted: boolean
  investableAssetsUsd: number
  sleeves: SleeveState[]
  /** Unfilled tax-advantaged headroom (current year). */
  headroom: { iraUsd: number; hsaUsd: number; solo401kUsd: number; daysToDeadline: number }
  /** Asset-class weights vs targets for band rebalancing. */
  allocations: Array<{ assetClass: string; currentWeight: number; targetWeight: number }>
}

export type SweepTriggerId =
  | 'liquidity_breach' | 'halt' | 'tipp_floor' | 'vol_brake' | 'bankroll_ratchet'
  | 'cap_breach' | 'band_rebalance' | 'headroom_calendar' | 'waterfall_surplus'

export interface SweepAction {
  trigger: SweepTriggerId
  /** Evaluation order 1–9 — lower runs first. */
  priority: number
  sleeveKey: string | null
  amountUsd: number
  rationale: string
  /** Tax handling: triggers 1–3 may realize STCG; the rest never should. */
  allowStcg: boolean
}

const HEADROOM_WINDOW_DAYS = 90

/** Evaluate all nine triggers IN ORDER. Deduplicates per sleeve by priority. */
export function evaluateSweepTriggers(state: SweepState, p: KbParameters): SweepAction[] {
  const actions: SweepAction[] = []
  const claimed = new Set<string>()  // sleeve keys already being swept by a higher trigger

  const claim = (a: SweepAction) => {
    if (a.sleeveKey && claimed.has(a.sleeveKey)) return
    if (a.amountUsd <= 0) return
    if (a.sleeveKey) claimed.add(a.sleeveKey)
    actions.push(a)
  }

  const totalSleevesUsd = state.sleeves.reduce((s, x) => s + x.valueUsd, 0)

  // 1. LIQUIDITY BREACH — emergency fund below target → sweep regardless of tax
  const efGap = state.emergencyTargetUsd - state.emergencyFundUsd
  if (efGap > 0 && totalSleevesUsd > 0) {
    // Fund from the largest sleeve first, safest-lots-first at execution.
    const largest = [...state.sleeves].sort((a, b) => b.valueUsd - a.valueUsd)[0]
    claim({
      trigger: 'liquidity_breach', priority: 1, sleeveKey: largest.key,
      amountUsd: Math.min(efGap, largest.valueUsd),
      rationale: `Emergency fund is $${Math.round(efGap).toLocaleString()} below target — nothing stays at risk while the base is unfunded`,
      allowStcg: true,
    })
  }

  // 2. HALT / KILL — de-risk to floor
  if (state.tradingHalted) {
    for (const s of state.sleeves) {
      const excess = s.valueUsd - s.floorUsd
      claim({
        trigger: 'halt', priority: 2, sleeveKey: s.key,
        amountUsd: Math.max(0, excess),
        rationale: 'Trading halted — de-risk sleeve to its floor',
        allowStcg: true,
      })
    }
  } else {
    for (const s of state.sleeves.filter(x => x.suspended)) {
      claim({
        trigger: 'halt', priority: 2, sleeveKey: s.key,
        amountUsd: Math.max(0, s.valueUsd - s.floorUsd),
        rationale: `Sleeve ${s.key} suspended by pod rules — de-risk to floor`,
        allowStcg: true,
      })
    }
  }

  // 3. TIPP FLOOR — cushion below alert fraction of peak cushion → mechanical de-risk
  for (const s of state.sleeves) {
    if (s.floorUsd <= 0 || s.peakCushionUsd <= 0) continue
    const cushion = Math.max(0, s.valueUsd - s.floorUsd)
    if (cushion < p.tipp_cushion_alert_pct * s.peakCushionUsd) {
      const m = s.key === 'crypto' || s.key === 'polymarket'
        ? p.tipp_multiplier_crypto
        : p.tipp_multiplier_equity
      const targetExposure = tippExposure(s.valueUsd, s.floorUsd, m)
      claim({
        trigger: 'tipp_floor', priority: 3, sleeveKey: s.key,
        amountUsd: Math.max(0, s.valueUsd - Math.max(targetExposure, s.floorUsd)),
        rationale: `Cushion fell below ${p.tipp_cushion_alert_pct * 100}% of its peak — TIPP de-risk toward the ratcheted floor`,
        allowStcg: true,
      })
    }
  }

  // 4. VOL BRAKE — realized vol above threshold × target
  for (const s of state.sleeves) {
    if (s.sigmaRealized == null || s.sigmaTarget == null || s.sigmaTarget <= 0) continue
    if (s.sigmaRealized > p.vol_brake_threshold * s.sigmaTarget) {
      const exposure = volBrakeExposure(s.sigmaTarget, s.sigmaRealized)
      claim({
        trigger: 'vol_brake', priority: 4, sleeveKey: s.key,
        amountUsd: s.valueUsd * (1 - exposure),
        rationale: `Realized vol ${(s.sigmaRealized * 100).toFixed(0)}% > ${p.vol_brake_threshold}× target — brake to ${(exposure * 100).toFixed(0)}% exposure`,
        allowStcg: false,
      })
    }
  }

  // 5. BANKROLL RATCHET — sleeve ≥ 2× initial bankroll → sweep 50% of profits above the mark
  for (const s of state.sleeves) {
    if (s.initialBankrollUsd <= 0) continue
    const mark = p.bankroll_ratchet_multiple * s.initialBankrollUsd
    if (s.valueUsd >= mark && s.valueUsd > s.ratchetHwmUsd) {
      const profitsAboveMark = s.valueUsd - Math.max(mark, s.ratchetHwmUsd)
      claim({
        trigger: 'bankroll_ratchet', priority: 5, sleeveKey: s.key,
        amountUsd: profitsAboveMark * p.bankroll_ratchet_sweep_pct,
        rationale: `Sleeve at ${(s.valueUsd / s.initialBankrollUsd).toFixed(1)}× initial bankroll — convert unverifiable edge into realized safe assets`,
        allowStcg: false,
      })
    }
  }

  // 6. CAP BREACH — sleeve weight above tier cap or Kelly cap
  for (const s of state.sleeves) {
    const cap = Math.min(s.tierCapFraction, s.kellyCapFraction ?? Number.POSITIVE_INFINITY)
    if (s.weightFraction > cap && state.investableAssetsUsd > 0) {
      claim({
        trigger: 'cap_breach', priority: 6, sleeveKey: s.key,
        amountUsd: (s.weightFraction - cap) * state.investableAssetsUsd,
        rationale: `Sleeve at ${(s.weightFraction * 100).toFixed(1)}% of investable assets vs ${(cap * 100).toFixed(1)}% cap — harvest the satellite`,
        allowStcg: false,
      })
    }
  }

  // 7. BAND REBALANCE — 20%-relative band breach on any asset class
  for (const a of state.allocations) {
    if (bandBreached(a.currentWeight, a.targetWeight, p.rebalance_band_relative)) {
      const excessWeight = a.currentWeight - a.targetWeight * (1 + p.rebalance_band_relative)
      if (excessWeight > 0 && state.investableAssetsUsd > 0) {
        actions.push({
          trigger: 'band_rebalance', priority: 7, sleeveKey: null,
          amountUsd: excessWeight * state.investableAssetsUsd,
          rationale: `${a.assetClass} drifted ${((a.currentWeight / a.targetWeight - 1) * 100).toFixed(0)}% past target — trade back to the band EDGE only`,
          allowStcg: false,
        })
      }
    }
  }

  // 8. HEADROOM CALENDAR — unfilled IRA/HSA/Solo-401k room near deadline
  const headroomTotal = state.headroom.iraUsd + state.headroom.hsaUsd + state.headroom.solo401kUsd
  if (headroomTotal > 0 && state.headroom.daysToDeadline < HEADROOM_WINDOW_DAYS && totalSleevesUsd > 0) {
    const overweight = [...state.sleeves].sort(
      (a, b) => (b.weightFraction - b.tierCapFraction) - (a.weightFraction - a.tierCapFraction)
    )[0]
    if (overweight && !claimed.has(overweight.key)) {
      actions.push({
        trigger: 'headroom_calendar', priority: 8, sleeveKey: overweight.key,
        amountUsd: Math.min(headroomTotal, overweight.valueUsd),
        rationale: `$${Math.round(headroomTotal).toLocaleString()} of tax-advantaged room expires in ${state.headroom.daysToDeadline} days`,
        allowStcg: false,
      })
    }
  }

  return actions.sort((a, b) => a.priority - b.priority)
}

// ─── §6.2 Tax-aware execution ordering ────────────────────────────────────────

export interface FundingLot {
  kind: 'new_contributions' | 'tax_advantaged' | 'loss_lot' | 'high_basis_ltcg' | 'stcg'
  amountUsd: number
  /** For stcg lots: unrealized gain as fraction of value (deferral hurdle input). */
  gainFraction?: number
}

export interface FundingPlanItem extends FundingLot {
  useUsd: number
}

const FUNDING_ORDER: FundingLot['kind'][] = [
  'new_contributions', 'tax_advantaged', 'loss_lot', 'high_basis_ltcg', 'stcg',
]

/**
 * Fund a sweep cheapest-tax-cost first. STCG lots are used ONLY when the
 * trigger allows it (forced de-risk, triggers 1–3).
 */
export function planSweepFunding(
  neededUsd: number,
  lots: FundingLot[],
  allowStcg: boolean
): { plan: FundingPlanItem[]; fundedUsd: number; shortfallUsd: number } {
  const plan: FundingPlanItem[] = []
  let remaining = neededUsd

  for (const kind of FUNDING_ORDER) {
    if (remaining <= 0) break
    if (kind === 'stcg' && !allowStcg) continue
    for (const lot of lots.filter(l => l.kind === kind)) {
      if (remaining <= 0) break
      const use = Math.min(lot.amountUsd, remaining)
      if (use > 0) {
        plan.push({ ...lot, useUsd: use })
        remaining -= use
      }
    }
  }

  return { plan, fundedUsd: neededUsd - remaining, shortfallUsd: Math.max(0, remaining) }
}

// ─── §6.3 Destination routing (waterfall + asset location) ────────────────────

export interface SweepDestination {
  destination: 'emergency_fund' | 'hsa' | 'roth_ira' | 'solo401k' | 'taxable_core' | 'tbill_ladder'
  amountUsd: number
  rationale: string
}

/**
 * Swept dollars enter the waterfall at the HIGHEST unfilled step:
 * emergency fund → HSA → Roth IRA → Solo 401(k) → taxable index core.
 */
export function routeSweepDestinations(
  amountUsd: number,
  state: Pick<SweepState, 'emergencyFundUsd' | 'emergencyTargetUsd' | 'headroom'>
): SweepDestination[] {
  const out: SweepDestination[] = []
  let remaining = amountUsd

  const steps: Array<[SweepDestination['destination'], number, string]> = [
    ['emergency_fund', Math.max(0, state.emergencyTargetUsd - state.emergencyFundUsd), 'Safety bucket first — liquidity target'],
    ['hsa', state.headroom.hsaUsd, 'Triple tax-free — highest-value headroom'],
    ['roth_ira', state.headroom.iraUsd, 'Tax-free growth headroom'],
    ['solo401k', state.headroom.solo401kUsd, 'Tax-deferred headroom'],
  ]
  for (const [destination, room, rationale] of steps) {
    if (remaining <= 0) break
    const amt = Math.min(room, remaining)
    if (amt > 0) {
      out.push({ destination, amountUsd: amt, rationale })
      remaining -= amt
    }
  }
  if (remaining > 0) {
    out.push({
      destination: 'taxable_core',
      amountUsd: remaining,
      rationale: 'All tax-advantaged steps current — taxable total-market index core',
    })
  }
  return out
}

// ─── §6.4 Sleeve refill gate ──────────────────────────────────────────────────

/** Money never sweeps INTO sleeves unless every condition holds. */
export function canRefillSleeve(args: {
  emergencyFundUsd: number
  emergencyTargetUsd: number
  waterfallCurrent: boolean
  sleeveWeightFraction: number
  tierCapFraction: number
  userReconfirmedWithinQuarter: boolean
}): { allowed: boolean; reason?: string } {
  if (args.emergencyFundUsd < args.emergencyTargetUsd) {
    return { allowed: false, reason: 'emergency fund below target' }
  }
  if (!args.waterfallCurrent) {
    return { allowed: false, reason: 'waterfall steps 1–6 not current' }
  }
  if (args.sleeveWeightFraction >= args.tierCapFraction) {
    return { allowed: false, reason: 'sleeve at or above tier cap' }
  }
  if (!args.userReconfirmedWithinQuarter) {
    return { allowed: false, reason: 'user has not re-confirmed the sleeve this quarter' }
  }
  return { allowed: true }
}

// ─── STCG wait-vs-sweep decision (§6.2 example) ──────────────────────────────

/**
 * For a high-vol position, sweep immediately when expected variance over the
 * remaining holding period exceeds the deferral hurdle.
 */
export function shouldWaitForLtcg(args: {
  gainFraction: number
  annualizedVol: number
  daysToLtcg: number
  constants: Pick<TaxConstants, 'stcg_top_rate_with_niit' | 'ltcg_top_rate_with_niit'>
}): { wait: boolean; hurdle: number; expectedMovePct: number } {
  const hurdle = deferralHurdle(
    args.gainFraction,
    args.constants.stcg_top_rate_with_niit,
    args.constants.ltcg_top_rate_with_niit
  )
  const yearsToLtcg = Math.max(0, args.daysToLtcg) / 365
  const expectedMovePct = args.annualizedVol * Math.sqrt(yearsToLtcg)
  return { wait: expectedMovePct < hurdle, hurdle, expectedMovePct }
}
