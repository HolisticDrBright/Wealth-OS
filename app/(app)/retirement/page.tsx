import { getRetirementPlan } from '@/lib/actions/retirement'
import { RetirementClient } from './retirement-client'
import { computeRetirementSummary, projectYearByYear } from '@/lib/retirement-calculator'

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

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Retirement Planner</h1>
        <p className="text-sm text-gray-500 mt-1">Project your retirement readiness and optimize your path</p>
      </div>
      <RetirementClient plan={plan} summary={summary} projection={projection} />
    </div>
  )
}
