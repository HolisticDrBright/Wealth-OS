/**
 * Household planning Monte Carlo (Gap brief C1) — pure, deterministic under
 * a seed. Return generation is BLOCK BOOTSTRAP (12-month blocks) from
 * historical monthly returns — never i.i.d. normal. Trading sleeves bootstrap
 * from the user's own trade history when n ≥ 50; otherwise a conservative
 * fat-tailed prior (Student-t ν=4, MEAN 0 net of costs — no free alpha).
 * Outputs funded-ratio distribution, P(goal), drawdown percentiles, and
 * per-recommendation deltas.
 */

export interface PlanningInput {
  currentAge: number
  retireAge: number
  horizonAge: number
  marketBucketUsd: number
  sleeveUsd: number
  annualSavingsUsd: number
  /** 'self_employed' adds income shocks: higher σ + occasional zero months. */
  incomeStability: 'stable_w2' | 'variable' | 'self_employed'
  annualRetirementSpendUsd: number
  /** Historical MONTHLY returns for the market bucket (block bootstrap source). */
  marketMonthlyReturns: number[]
  /** User's own per-trade returns for the sleeves (used when n ≥ 50). */
  sleeveTradeReturns?: number[]
  /** Annual tax drag on the taxable share (fraction). */
  taxDragRate: number
  paths?: number
  seed?: number
}

export interface PlanningResult {
  goalProbabilityPct: number
  fundedRatioP10: number
  fundedRatioP50: number
  fundedRatioP90: number
  maxDrawdownP50Pct: number
  paths: number
}

const BLOCK_MONTHS = 12
const MIN_SLEEVE_HISTORY = 50
const T_NU = 4

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function runPlanningMonteCarlo(input: PlanningInput): PlanningResult {
  const paths = input.paths ?? 10_000
  const rand = mulberry32(input.seed ?? 42)
  const randn = () => {
    const u = Math.max(rand(), 1e-12)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
  }
  // Student-t(ν=4): normal / sqrt(chi²(ν)/ν) — the conservative sleeve prior.
  const randT = () => {
    let chi = 0
    for (let i = 0; i < T_NU; i++) chi += randn() ** 2
    return randn() / Math.sqrt(chi / T_NU)
  }

  const history = input.marketMonthlyReturns
  const zeroVol = history.length === 0 || history.every(r => r === history[0])
  const flatMonthly = history.length > 0 ? history[0] : 0

  // Block bootstrap: pick a random start, take 12 consecutive months (wrap).
  const drawYearBlock = (): number[] => {
    if (history.length < BLOCK_MONTHS) {
      return Array.from({ length: BLOCK_MONTHS }, () => flatMonthly)
    }
    const start = Math.floor(rand() * history.length)
    return Array.from({ length: BLOCK_MONTHS }, (_, i) => history[(start + i) % history.length])
  }

  const sleeveHistory = (input.sleeveTradeReturns ?? [])
  const useSleeveHistory = sleeveHistory.length >= MIN_SLEEVE_HISTORY
  // Conservative prior scale for the sleeve when no history: 35%/yr vol → monthly.
  const sleevePriorMonthlyVol = 0.35 / Math.sqrt(12)
  const drawSleeveMonthly = (): number => {
    if (useSleeveHistory) {
      return sleeveHistory[Math.floor(rand() * sleeveHistory.length)]
    }
    return randT() * sleevePriorMonthlyVol   // mean 0 — no free alpha
  }

  const monthsToRetire = Math.max(0, (input.retireAge - input.currentAge) * 12)
  const monthsRetired = Math.max(1, (input.horizonAge - input.retireAge) * 12)
  const monthlySpend = input.annualRetirementSpendUsd / 12
  const selfEmployed = input.incomeStability === 'self_employed'
  const incomeSigma = selfEmployed ? 0.35 : input.incomeStability === 'variable' ? 0.2 : 0.05
  const monthlyTaxDrag = input.taxDragRate / 12

  // Funded-ratio denominator: PV of retirement spending at a real discount
  // rate implied by the historical mean (floor 0.5%/yr).
  const histMeanAnnual = history.length
    ? history.reduce((s, r) => s + r, 0) / history.length * 12
    : 0.02
  const discountMonthly = Math.max(0.005, histMeanAnnual * 0.5) / 12
  const liabilityPv = monthlySpend * (1 - Math.pow(1 + discountMonthly, -monthsRetired)) / discountMonthly

  const fundedRatios: number[] = new Array(paths)
  const maxDds: number[] = new Array(paths)
  let successes = 0

  for (let p = 0; p < paths; p++) {
    let market = input.marketBucketUsd
    let sleeve = input.sleeveUsd
    let peak = market + sleeve
    let maxDd = 0
    let failed = false
    let block: number[] = drawYearBlock()

    const totalMonths = monthsToRetire + monthsRetired
    for (let m = 0; m < totalMonths; m++) {
      const bi = m % BLOCK_MONTHS
      if (bi === 0 && m > 0) block = drawYearBlock()
      const mktRet = (zeroVol ? flatMonthly : block[bi]) - monthlyTaxDrag
      market = Math.max(0, market * (1 + mktRet))
      sleeve = Math.max(0, sleeve * (1 + drawSleeveMonthly()))

      if (m < monthsToRetire) {
        // Accumulation: monthly savings with income shocks
        let contribution = input.annualSavingsUsd / 12
        if (!zeroVol) {
          const shock = 1 + randn() * incomeSigma
          const zeroMonth = selfEmployed && rand() < 0.03
          contribution = zeroMonth ? 0 : Math.max(0, contribution * shock)
        }
        market += contribution
      } else {
        // Decumulation: sequence risk is inherent — spend after the month's return
        let spend = monthlySpend
        const fromMarket = Math.min(market, spend)
        market -= fromMarket; spend -= fromMarket
        if (spend > 0) { const fs = Math.min(sleeve, spend); sleeve -= fs; spend -= fs }
        if (spend > 1e-9) { failed = true; break }
      }

      const value = market + sleeve
      peak = Math.max(peak, value)
      if (peak > 0) maxDd = Math.max(maxDd, (peak - value) / peak)
    }

    if (!failed) successes++
    const wealthAtRetire = market + sleeve   // terminal wealth proxy for the ratio
    fundedRatios[p] = liabilityPv > 0 ? (failed ? 0 : (wealthAtRetire + input.annualRetirementSpendUsd * 0) / liabilityPv) : 1
    maxDds[p] = maxDd
  }

  fundedRatios.sort((a, b) => a - b)
  maxDds.sort((a, b) => a - b)
  const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))]

  return {
    goalProbabilityPct: Math.round((successes / paths) * 1000) / 10,
    fundedRatioP10: Math.round(q(fundedRatios, 0.1) * 100) / 100,
    fundedRatioP50: Math.round(q(fundedRatios, 0.5) * 100) / 100,
    fundedRatioP90: Math.round(q(fundedRatios, 0.9) * 100) / 100,
    maxDrawdownP50Pct: Math.round(q(maxDds, 0.5) * 10000) / 100,
    paths,
  }
}

/** ΔP(goal) of an advisory recommendation: rerun with its computed benefit. */
export function planningRecommendationDelta(
  base: PlanningInput,
  annualBenefitUsd: number
): { basePct: number; withPct: number; deltaPct: number } {
  const a = runPlanningMonteCarlo(base)
  const b = runPlanningMonteCarlo({ ...base, annualSavingsUsd: base.annualSavingsUsd + annualBenefitUsd })
  return {
    basePct: a.goalProbabilityPct,
    withPct: b.goalProbabilityPct,
    deltaPct: Math.round((b.goalProbabilityPct - a.goalProbabilityPct) * 10) / 10,
  }
}

/**
 * Known-answer helper (C2): with a zero-volatility asset and fixed
 * withdrawals, the sustainable monthly withdrawal matches the annuity
 * formula W = V·r / (1 − (1+r)^−n).
 */
export function annuityMonthlyWithdrawal(valueUsd: number, monthlyRate: number, months: number): number {
  if (monthlyRate === 0) return valueUsd / months
  return valueUsd * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months))
}
