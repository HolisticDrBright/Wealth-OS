import { getRetirementPlan } from '@/lib/actions/retirement'
import { RetirementClient } from './retirement-client'
import { computeRetirementSummary, projectYearByYear } from '@/lib/retirement-calculator'
import { runMonteCarloRetirement } from '@/lib/retirement/monte-carlo'
import { planWithdrawals, type WithdrawalYear } from '@/lib/retirement/withdrawal-sequencing'

// Tax-rate assumptions for the withdrawal-sequencing estimate (decimals).
const ASSUMED_MARGINAL_RATE = 0.22
const ASSUMED_LTCG_RATE = 0.15

export default async function RetirementPage() {
  const plan = await getRetirementPlan()

  const summary = plan ? computeRetirementSummary(plan) : null
  const projection = plan ? projectYearByYear(
    plan.current_savings_usd,
    plan.annual_contribution_usd,
    plan.expected_return_pct / 100,
    Math.max(0, (plan.target_retirement_age - (plan.current_age ?? 35))),
    25,
    (plan.target_monthly_income_usd ?? 5000)
  ) : []

  // Monte Carlo simulation — fixed seed keeps the page stable between renders.
  const monteCarlo = plan
    ? runMonteCarloRetirement(plan, { paths: 1000, seed: 42 })
    : null

  // Tax-optimized withdrawal sequencing: first retirement year's breakdown.
  let withdrawalFirstYear: WithdrawalYear | null = null
  if (plan) {
    const annualNeed = Math.max(
      0,
      (plan.target_monthly_income_usd ?? 5000)
        - plan.social_security_monthly_usd
        - plan.pension_monthly_usd
    ) * 12
    const withdrawalPlan = planWithdrawals({
      taxableBalance: plan.taxable_balance_usd,
      traditionalBalance: plan.k401_balance_usd + plan.ira_balance_usd,
      rothBalance: plan.roth_ira_balance_usd,
      annualNeed,
      age: plan.target_retirement_age,
      marginalRate: ASSUMED_MARGINAL_RATE,
      ltcgRate: ASSUMED_LTCG_RATE,
    })
    withdrawalFirstYear = withdrawalPlan.years[0] ?? null
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Retirement Planner</h1>
        <p className="text-sm text-gray-500 mt-1">Project your retirement readiness and optimize your path</p>
      </div>
      <RetirementClient
        plan={plan}
        summary={summary}
        projection={projection}
        monteCarlo={monteCarlo}
        withdrawalFirstYear={withdrawalFirstYear}
      />
    </div>
  )
}
