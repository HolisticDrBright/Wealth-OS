/**
 * R6 — Solo 401(k).
 *
 * 2026 limits from tax_constants, including the age-60–63 enhanced catch-up
 * and the Roth catch-up mandate above the prior-year wage threshold.
 * Models the S-corp interaction: employer contribution = 25% of W-2 salary
 * only (cross-references R1).
 */

import {
  type AdvisoryRule, type FinancialProfile, type TaxConstants, type KbParameters,
  type RuleVerdict, type MathLine,
  missingRequiredFields, notApplicable, contraindicated,
} from '../types'
import { computeSeTax } from './r1-scorp-election'

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

const CATCHUP_AGE = 50
const ENHANCED_CATCHUP_START = 60
const ENHANCED_CATCHUP_END = 63
const HALF = 0.5

export const r6Solo401k: AdvisoryRule = {
  id: 'r6_solo_401k',
  version: 1,
  title: 'Solo 401(k) room unfilled',
  requiredFields: ['net_business_profit_usd', 'has_employees', 'age_self', 'ytd_401k_employee_usd', 'business_entity'],

  evaluate(profile: FinancialProfile, c: TaxConstants, p: KbParameters): RuleVerdict {
    const missing = missingRequiredFields(this, profile)
    if (missing.length) {
      return notApplicable(this, `Answer ${missing.length} question(s) to unlock this analysis`, missing)
    }
    if ((profile.net_business_profit_usd ?? 0) <= 0) {
      return notApplicable(this, 'No self-employment income on file')
    }
    if (profile.has_employees && !profile.spouse_only_employee) {
      return contraindicated(this, 'Solo 401(k)s require no employees other than a spouse — a standard 401(k) applies instead')
    }

    const age = profile.age_self!
    const catchup =
      age >= ENHANCED_CATCHUP_START && age <= ENHANCED_CATCHUP_END ? c['401k_catchup_60_63']
      : age >= CATCHUP_AGE ? c['401k_catchup_50']
      : 0
    const employeeLimit = c.solo401k_employee + catchup
    const employeeRoom = Math.max(0, employeeLimit - (profile.ytd_401k_employee_usd ?? 0))

    const profit = profile.net_business_profit_usd!
    const isScorp = profile.business_entity === 'scorp' || profile.business_entity === 'llc_scorp'

    // Employer profit-sharing: S-corp → 25% of W-2 SALARY only.
    // Unincorporated → effectively 20% of (profit − ½ SE tax).
    const math: MathLine[] = []
    let employerRoom: number
    if (isScorp) {
      const salary = profile.w2_wages_usd ?? 0
      employerRoom = salary * c.scorp_employer_match_factor
      math.push({
        label: 'Employer contribution (S-corp: W-2 salary only)',
        formula: `${usd(salary)} × ${c.scorp_employer_match_factor * 100}%`,
        valueUsd: employerRoom,
      })
    } else {
      const adjusted = profit - computeSeTax(profit, c) * HALF
      employerRoom = adjusted * (c.scorp_employer_match_factor / (1 + c.scorp_employer_match_factor))
      math.push({
        label: 'Employer contribution (sole prop / LLC)',
        formula: `(${usd(profit)} − ½ SE tax) × 20% effective`,
        valueUsd: employerRoom,
      })
    }

    const totalRoom = Math.min(employeeRoom + employerRoom, c.solo401k_total)
    if (totalRoom <= 0) {
      return notApplicable(this, 'This year’s Solo 401(k) room is already filled')
    }

    const benefit = Math.round(Math.min(employeeRoom, totalRoom) * p.assumed_marginal_rate)
    const rothMandate = (profile.prior_year_wages_usd ?? 0) > c.roth_catchup_mandate_wage_threshold && catchup > 0

    math.unshift(
      { label: `Employee deferral limit${catchup ? ` incl. ${age >= ENHANCED_CATCHUP_START ? '60–63 enhanced' : '50+'} catch-up` : ''}`, formula: `${usd(c.solo401k_employee)}${catchup ? ` + ${usd(catchup)}` : ''}`, valueUsd: employeeLimit },
      { label: 'Deferred year-to-date', formula: 'from your profile', valueUsd: -(profile.ytd_401k_employee_usd ?? 0) },
    )
    math.push(
      { label: `Total room (capped at ${usd(c.solo401k_total)})`, formula: 'employee + employer, capped', valueUsd: totalRoom },
      { label: 'Estimated tax deferred', formula: `deferral × ${p.assumed_marginal_rate * 100}% marginal rate`, valueUsd: benefit },
    )

    const counterIndications = [
      'Contribution math depends on final net profit — true up with your CPA at year-end',
      ...(rothMandate ? [`Prior-year wages exceed ${usd(c.roth_catchup_mandate_wage_threshold)} — catch-up contributions MUST be Roth in 2026`] : []),
      ...(!isScorp && (profile.business_entity === 'llc' || profile.business_entity === 'sole_prop')
        ? ['If you elect S-corp status (see that card), employer contributions become 25% of W-2 salary only — a $60k salary caps the employer side at $15k. Model the combined optimum before electing.']
        : []),
    ]

    return {
      kind: 'recommendation',
      ruleId: this.id, ruleVersion: this.version,
      title: `Solo 401(k): ${usd(totalRoom)} of room available`,
      rationale:
        `Self-employment income with no (non-spouse) employees qualifies you for a Solo 401(k): ` +
        `${usd(employeeRoom)} employee deferral room plus roughly ${usd(Math.max(0, employerRoom))} of ` +
        `employer profit-sharing, up to the ${usd(c.solo401k_total)} combined cap. The deferral also ` +
        `preserves your QBI deduction relative to a SEP-IRA.`,
      estimatedAnnualBenefitUsd: benefit,
      math,
      actionSteps: [
        'Open the plan before Dec 31 (contributions can follow until the filing deadline)',
        `Defer up to ${usd(employeeRoom)} as employee; add employer profit-sharing per the math above`,
        'A Solo 401(k) also accepts pre-tax IRA roll-INS — clears the backdoor-Roth pro-rata trap (see that card)',
      ],
      deadline: null,
      counterIndications,
    }
  },
}
