/**
 * R5 — Business deductions checklist.
 *
 * Interactive annual checklist for anyone with business income. Every rate
 * ($/mile, safe-harbor $/sqft) comes from tax_constants — the source list's
 * $0.67/mile was a stale 2024 number.
 */

import {
  type AdvisoryRule, type FinancialProfile, type TaxConstants, type KbParameters,
  type RuleVerdict, type MathLine,
  missingRequiredFields, notApplicable,
} from '../types'

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

export const r5BusinessDeductions: AdvisoryRule = {
  id: 'r5_business_deductions',
  version: 1,
  title: 'Business deductions checklist',
  requiredFields: ['net_business_profit_usd'],

  evaluate(profile: FinancialProfile, c: TaxConstants, p: KbParameters): RuleVerdict {
    const missing = missingRequiredFields(this, profile)
    if (missing.length) {
      return notApplicable(this, `Answer ${missing.length} question(s) to unlock this analysis`, missing)
    }
    if ((profile.net_business_profit_usd ?? 0) <= 0) {
      return notApplicable(this, 'No business income on file')
    }

    const math: MathLine[] = []
    let estimatedDeductions = 0

    if (profile.home_office_sqft && profile.home_office_sqft > 0) {
      const sqft = Math.min(profile.home_office_sqft, c.home_office_safe_harbor_max_sqft)
      const amount = sqft * c.home_office_safe_harbor_per_sqft
      estimatedDeductions += amount
      math.push({
        label: 'Home office (safe harbor)',
        formula: `${sqft} sqft × $${c.home_office_safe_harbor_per_sqft}/sqft (capped at ${c.home_office_safe_harbor_max_sqft} sqft)`,
        valueUsd: amount,
      })
    }

    if (profile.business_miles_annual && profile.business_miles_annual > 0) {
      const amount = profile.business_miles_annual * c.mileage_rate_business
      estimatedDeductions += amount
      math.push({
        label: 'Business mileage',
        formula: `${profile.business_miles_annual.toLocaleString()} miles × $${c.mileage_rate_business}/mile`,
        valueUsd: amount,
      })
    }

    const estimatedSavings = Math.round(estimatedDeductions * p.assumed_marginal_rate)
    if (estimatedDeductions > 0) {
      math.push({
        label: 'Estimated tax saved',
        formula: `${usd(estimatedDeductions)} × ${p.assumed_marginal_rate * 100}% marginal rate`,
        valueUsd: estimatedSavings,
      })
    }

    return {
      kind: 'recommendation',
      ruleId: this.id, ruleVersion: this.version,
      title: 'Work the deductions checklist',
      rationale:
        'With business income, a yearly pass over the standard deduction list usually pays for itself. ' +
        'The items below compute from your profile where possible; the rest are prompts to track.',
      estimatedAnnualBenefitUsd: estimatedDeductions > 0 ? estimatedSavings : null,
      math,
      actionSteps: [
        'Home office: compare the safe harbor above vs. the actual-expense method with your CPA',
        'Mileage: keep a contemporaneous log (app-based) — reconstructed logs fail audits',
        'Self-employed health insurance premiums: above-the-line deduction',
        'Meals with business purpose: 50% deductible — keep receipts and note attendees',
        'Software, supplies, professional education: deduct in the year purchased',
      ],
      deadline: null,
      counterIndications: [
        'Home office must be REGULAR and EXCLUSIVE business use',
        'Commuting miles never count as business mileage',
      ],
    }
  },
}
