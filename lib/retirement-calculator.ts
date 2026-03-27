/** Future value of a lump sum + annual contributions over N years */
export function computeFutureValue(
  presentValue: number,
  annualRate: number, // decimal e.g. 0.07
  years: number,
  annualContribution: number
): number {
  if (years <= 0) return presentValue
  const r = annualRate
  const pvGrowth = presentValue * Math.pow(1 + r, years)
  const contribGrowth = r === 0
    ? annualContribution * years
    : annualContribution * ((Math.pow(1 + r, years) - 1) / r)
  return pvGrowth + contribGrowth
}

/** Required nest egg to fund a monthly income for N years (present value of annuity) */
export function computeRequiredNestEgg(
  targetMonthlyIncome: number,
  yearsOfRetirement: number,
  annualRate: number
): number {
  const monthlyRate = annualRate / 12
  const n = yearsOfRetirement * 12
  if (monthlyRate === 0) return targetMonthlyIncome * n
  return targetMonthlyIncome * (1 - Math.pow(1 + monthlyRate, -n)) / monthlyRate
}

/** Year-by-year projection for chart */
export function projectYearByYear(
  currentSavings: number,
  annualContribution: number,
  annualReturnRate: number,
  yearsToRetirement: number,
  yearsInRetirement = 25,
  monthlyWithdrawal = 0
): Array<{ year: number; age?: number; balance: number; phase: 'accumulation' | 'retirement' }> {
  const points: Array<{ year: number; age?: number; balance: number; phase: 'accumulation' | 'retirement' }> = []
  let balance = currentSavings
  const r = annualReturnRate

  for (let y = 0; y <= yearsToRetirement; y++) {
    points.push({ year: y, balance: Math.max(0, balance), phase: 'accumulation' })
    balance = balance * (1 + r) + annualContribution
  }

  for (let y = 1; y <= yearsInRetirement; y++) {
    balance = balance * (1 + r) - monthlyWithdrawal * 12
    points.push({ year: yearsToRetirement + y, balance: Math.max(0, balance), phase: 'retirement' })
  }

  return points
}

export interface RetirementSummary {
  projected_balance: number
  required_nest_egg: number
  income_gap_monthly: number
  on_track: boolean
  years_to_retirement: number
  annual_shortfall: number
}

export function computeRetirementSummary(plan: {
  current_age?: number
  target_retirement_age: number
  current_savings_usd: number
  annual_contribution_usd: number
  expected_return_pct: number
  target_monthly_income_usd?: number
  social_security_monthly_usd: number
  pension_monthly_usd: number
}): RetirementSummary {
  const yearsToRetirement = (plan.target_retirement_age - (plan.current_age ?? 35))
  const r = plan.expected_return_pct / 100

  const projectedBalance = computeFutureValue(
    plan.current_savings_usd,
    r,
    Math.max(0, yearsToRetirement),
    plan.annual_contribution_usd
  )

  const otherIncome = (plan.social_security_monthly_usd + plan.pension_monthly_usd)
  const targetMonthly = plan.target_monthly_income_usd ?? 5000
  const neededFromPortfolio = Math.max(0, targetMonthly - otherIncome)

  const requiredNestEgg = computeRequiredNestEgg(neededFromPortfolio, 25, r)

  const incomeGapMonthly = neededFromPortfolio > 0
    ? neededFromPortfolio - (projectedBalance * r / 12)
    : 0

  return {
    projected_balance: projectedBalance,
    required_nest_egg: requiredNestEgg,
    income_gap_monthly: incomeGapMonthly,
    on_track: projectedBalance >= requiredNestEgg,
    years_to_retirement: Math.max(0, yearsToRetirement),
    annual_shortfall: Math.max(0, (requiredNestEgg - projectedBalance) / Math.max(1, yearsToRetirement)),
  }
}
