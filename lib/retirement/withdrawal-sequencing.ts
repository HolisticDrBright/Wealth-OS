/**
 * Tax-optimized withdrawal sequencing.
 *
 * Standard ordering: taxable first (taxed at long-term capital gains rates),
 * then traditional/pre-tax (taxed as ordinary income, with Required Minimum
 * Distributions forced from age 73 under SECURE 2.0), and Roth last so
 * tax-free growth is preserved as long as possible.
 *
 * Simplifications (documented, intentional):
 * - The full taxable withdrawal is treated as a realized gain when
 *   estimating tax (cost basis is not tracked), so taxable-account tax is
 *   an upper-bound estimate.
 * - Balances grow at an optional flat rate (default 0% so the schedule is
 *   easy to reason about and tests are crisp).
 */

/**
 * IRS Uniform Lifetime Table (distribution periods), effective 2022+.
 * RMD = prior year-end balance / factor. Hardcoded by design.
 */
export const UNIFORM_LIFETIME_TABLE: Record<number, number> = {
  73: 26.5,
  74: 25.5,
  75: 24.6,
  76: 23.7,
  77: 22.9,
  78: 22.0,
  79: 21.1,
  80: 20.2,
  81: 19.4,
  82: 18.5,
  83: 17.7,
  84: 16.8,
  85: 16.0,
  86: 15.2,
  87: 14.4,
  88: 13.7,
  89: 12.9,
  90: 12.2,
  91: 11.5,
  92: 10.8,
  93: 10.1,
  94: 9.5,
  95: 8.9,
  96: 8.4,
  97: 7.8,
  98: 7.3,
  99: 6.8,
  100: 6.4,
  101: 6.0,
  102: 5.6,
  103: 5.2,
  104: 4.9,
  105: 4.6,
  106: 4.3,
  107: 4.1,
  108: 3.9,
  109: 3.7,
  110: 3.5,
  111: 3.4,
  112: 3.3,
  113: 3.1,
  114: 3.0,
  115: 2.9,
  116: 2.8,
  117: 2.7,
  118: 2.5,
  119: 2.3,
  120: 2.0,
}

/** Age at which RMDs begin (SECURE 2.0). */
export const RMD_START_AGE = 73

/** RMD for a given age and traditional balance. Zero before age 73. */
export function computeRmd(age: number, traditionalBalance: number): number {
  if (age < RMD_START_AGE || traditionalBalance <= 0) return 0
  const factor = UNIFORM_LIFETIME_TABLE[Math.min(age, 120)] ?? 2.0
  return traditionalBalance / factor
}

export interface WithdrawalPlanInput {
  taxableBalance: number
  traditionalBalance: number
  rothBalance: number
  /** Annual spending need (gross of taxes is NOT modeled; this is the draw). */
  annualNeed: number
  /** Age in the first withdrawal year. */
  age: number
  /** Marginal ordinary income tax rate, decimal (e.g. 0.24). */
  marginalRate: number
  /** Long-term capital gains rate, decimal (e.g. 0.15). */
  ltcgRate: number
  /** Optional flat annual growth applied to remaining balances. Default 0. */
  growthRatePct?: number
  /** Max years to plan. Default: through age 95. */
  years?: number
}

export interface WithdrawalYear {
  year: number
  age: number
  fromTaxable: number
  fromTraditional: number
  fromRoth: number
  /** Portion of the traditional withdrawal that was forced by the RMD. */
  rmdForced: number
  estimatedTax: number
  /** Unmet need after all sources are exhausted. */
  shortfall: number
  endingTaxable: number
  endingTraditional: number
  endingRoth: number
}

export interface WithdrawalPlan {
  years: WithdrawalYear[]
  totalEstimatedTax: number
  /** Age at which all sources were exhausted, or null if funds lasted. */
  depletionAge: number | null
}

export function planWithdrawals(input: WithdrawalPlanInput): WithdrawalPlan {
  const growth = (input.growthRatePct ?? 0) / 100
  const horizon = input.years ?? Math.max(1, 95 - input.age + 1)

  let taxable = Math.max(0, input.taxableBalance)
  let traditional = Math.max(0, input.traditionalBalance)
  let roth = Math.max(0, input.rothBalance)

  const years: WithdrawalYear[] = []
  let totalEstimatedTax = 0
  let depletionAge: number | null = null

  for (let y = 0; y < horizon; y++) {
    const age = input.age + y

    // 1) RMD is forced from traditional at 73+, regardless of need.
    const rmd = Math.min(computeRmd(age, traditional), traditional)
    let fromTraditional = rmd
    traditional -= rmd

    // RMD proceeds count toward the year's spending need.
    let remaining = Math.max(0, input.annualNeed - rmd)

    // 2) Taxable first (LTCG rates).
    const fromTaxable = Math.min(taxable, remaining)
    taxable -= fromTaxable
    remaining -= fromTaxable

    // 3) Traditional next (ordinary income).
    const extraTraditional = Math.min(traditional, remaining)
    traditional -= extraTraditional
    fromTraditional += extraTraditional
    remaining -= extraTraditional

    // 4) Roth last — preserved until everything else is gone.
    const fromRoth = Math.min(roth, remaining)
    roth -= fromRoth
    remaining -= fromRoth

    const estimatedTax =
      fromTaxable * input.ltcgRate + fromTraditional * input.marginalRate
    totalEstimatedTax += estimatedTax

    if (
      depletionAge === null &&
      remaining > 0.005 &&
      taxable <= 0 &&
      traditional <= 0 &&
      roth <= 0
    ) {
      depletionAge = age
    }

    // Grow remaining balances for next year.
    taxable *= 1 + growth
    traditional *= 1 + growth
    roth *= 1 + growth

    years.push({
      year: y + 1,
      age,
      fromTaxable,
      fromTraditional,
      fromRoth,
      rmdForced: rmd,
      estimatedTax,
      shortfall: remaining,
      endingTaxable: taxable,
      endingTraditional: traditional,
      endingRoth: roth,
    })

    // Stop early once everything is depleted (after recording the year).
    if (taxable <= 0 && traditional <= 0 && roth <= 0 && depletionAge !== null) {
      break
    }
  }

  return { years, totalEstimatedTax, depletionAge }
}
