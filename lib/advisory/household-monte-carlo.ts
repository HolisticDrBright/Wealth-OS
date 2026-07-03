/**
 * Household Monte Carlo (Gap Analysis #7) — the funded-ratio simulation a
 * $5k/yr planner sells: whole-household paths over income volatility,
 * spending, tax drag, sequence risk, with the trading sleeves as a
 * FAT-TAILED asset. Bootstrap + Student-t shocks, never plain normals.
 * Outputs goal probability with BANDS, plus the marginal impact of an
 * advisory recommendation ("the S-Corp election moves 87% → 91%").
 */

export interface HouseholdMcInput {
  ages: { current: number; retire: number; horizon: number }
  investableUsd: number
  sleeveUsd: number
  annualSavingsUsd: number
  /** Std dev of annual savings (income volatility — key for self-employed). */
  savingsVolUsd: number
  retirementSpendUsd: number
  /** Market bucket return/vol (real). */
  marketReturn: number
  marketVol: number
  /** Sleeve return/vol — fat-tailed via Student-t(3). */
  sleeveReturn: number
  sleeveVol: number
  /** Annual tax drag on taxable growth (fraction). */
  taxDragRate: number
  paths?: number
  seed?: number
}

export interface HouseholdMcResult {
  goalProbabilityPct: number
  medianTerminalUsd: number
  p10TerminalUsd: number
  p90TerminalUsd: number
  paths: number
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function runHouseholdMonteCarlo(input: HouseholdMcInput): HouseholdMcResult {
  const paths = input.paths ?? 1000
  const rand = mulberry32(input.seed ?? 42)
  const randn = () => {
    const u = Math.max(rand(), 1e-12)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
  }
  // Student-t(ν=3) via normal/chi ratio — fat tails for the sleeve.
  const randT3 = () => {
    const z = randn()
    const chi = randn() ** 2 + randn() ** 2 + randn() ** 2
    return z / Math.sqrt(chi / 3)
  }

  const yearsToRetire = Math.max(0, input.ages.retire - input.ages.current)
  const yearsRetired = Math.max(1, input.ages.horizon - input.ages.retire)
  const terminals: number[] = []
  let successes = 0

  for (let p = 0; p < paths; p++) {
    let market = input.investableUsd
    let sleeve = input.sleeveUsd
    let failed = false

    for (let y = 0; y < yearsToRetire; y++) {
      const savings = Math.max(0, input.annualSavingsUsd + randn() * input.savingsVolUsd)
      market = Math.max(0, market * (1 + input.marketReturn - input.taxDragRate + randn() * input.marketVol) + savings)
      sleeve = Math.max(0, sleeve * (1 + input.sleeveReturn + randT3() * input.sleeveVol))
    }
    for (let y = 0; y < yearsRetired; y++) {
      market = market * (1 + input.marketReturn - input.taxDragRate + randn() * input.marketVol)
      sleeve = Math.max(0, sleeve * (1 + input.sleeveReturn + randT3() * input.sleeveVol))
      // Sequence risk is inherent: spending comes out AFTER the year's return.
      let spend = input.retirementSpendUsd
      const fromMarket = Math.min(market, spend)
      market -= fromMarket
      spend -= fromMarket
      if (spend > 0) {
        const fromSleeve = Math.min(sleeve, spend)
        sleeve -= fromSleeve
        spend -= fromSleeve
      }
      if (spend > 0) { failed = true; break }
    }

    if (!failed) successes++
    terminals.push(Math.max(0, market + sleeve))
  }

  terminals.sort((a, b) => a - b)
  const pct = (q: number) => terminals[Math.min(terminals.length - 1, Math.floor(q * terminals.length))]

  return {
    goalProbabilityPct: Math.round((successes / paths) * 1000) / 10,
    medianTerminalUsd: Math.round(pct(0.5)),
    p10TerminalUsd: Math.round(pct(0.1)),
    p90TerminalUsd: Math.round(pct(0.9)),
    paths,
  }
}

/** Marginal impact of a recommendation: rerun with its benefit added to savings. */
export function recommendationImpact(
  base: HouseholdMcInput,
  annualBenefitUsd: number
): { basePct: number; withPct: number; deltaPct: number } {
  const baseline = runHouseholdMonteCarlo(base)
  const improved = runHouseholdMonteCarlo({
    ...base,
    annualSavingsUsd: base.annualSavingsUsd + annualBenefitUsd,
  })
  return {
    basePct: baseline.goalProbabilityPct,
    withPct: improved.goalProbabilityPct,
    deltaPct: Math.round((improved.goalProbabilityPct - baseline.goalProbabilityPct) * 10) / 10,
  }
}
