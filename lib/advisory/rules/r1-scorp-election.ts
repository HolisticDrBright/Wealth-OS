/**
 * R1 — S-Corp election.
 *
 * Corrected math (the source list overstated savings): SE tax applies to
 * 92.35% of net profit and the SS portion caps at the wage base. All rates
 * and limits come from tax_constants — nothing hardcoded.
 */

import {
  type AdvisoryRule, type FinancialProfile, type TaxConstants, type KbParameters,
  type RuleVerdict, type MathLine,
  missingRequiredFields, notApplicable, contraindicated,
} from '../types'

const HALF = 0.5
const FULL = 1
// Form 2553 deadline: March 15 (month index 2) for current-year effect.
const FORM_2553_MONTH_IDX = 2
const FORM_2553_DAY = 15

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

/** SE tax with the SS wage-base cap applied. */
export function computeSeTax(netProfit: number, c: TaxConstants): number {
  const base = netProfit * c.se_earnings_factor
  const ssTaxable = Math.min(base, c.ss_wage_base)
  return ssTaxable * c.se_ss_rate + base * c.se_medicare_rate
}

/** Combined employer+employee FICA on a W-2 salary (both sides borne by the owner). */
export function computeFicaOnSalary(salary: number, c: TaxConstants): number {
  const ssTaxable = Math.min(salary, c.ss_wage_base)
  return ssTaxable * c.se_ss_rate + salary * c.se_medicare_rate
}

export const r1ScorpElection: AdvisoryRule = {
  id: 'r1_scorp_election',
  version: 1,
  title: 'S-Corp election could cut self-employment tax',
  requiredFields: ['business_entity', 'net_business_profit_usd', 'state'],

  evaluate(profile: FinancialProfile, c: TaxConstants, p: KbParameters): RuleVerdict {
    const missing = missingRequiredFields(this, profile)
    if (missing.length) {
      return notApplicable(this, `Answer ${missing.length} question(s) to unlock this analysis`, missing)
    }

    const entity = profile.business_entity!
    if (entity === 'scorp' || entity === 'llc_scorp') {
      return notApplicable(this, 'Already taxed as an S-corp')
    }
    if (entity !== 'llc' && entity !== 'sole_prop') {
      return notApplicable(this, `Entity type ${entity} is out of scope for this rule`)
    }

    const profit = profile.net_business_profit_usd!
    if (profit < p.scorp_contraindicated_profit) {
      return contraindicated(this,
        `At ${usd(profit)} net profit, payroll/filing overhead typically eats the savings`)
    }
    if (profit < p.scorp_min_profit) {
      return notApplicable(this,
        `Net profit ${usd(profit)} is below the ${usd(p.scorp_min_profit)} threshold — revisit as profit grows`)
    }

    // ── The corrected math ─────────────────────────────────────────────────
    const seTax = computeSeTax(profit, c)
    const salary = Math.max(p.scorp_min_reasonable_salary, profit * p.scorp_reasonable_salary_factor)
    if (profit - salary < p.scorp_min_distribution) {
      return contraindicated(this,
        'A reasonable salary would consume nearly all profit — no distribution left to shield')
    }

    const fica = computeFicaOnSalary(salary, c)
    const grossSavings = seTax - fica

    const payrollCost = (p.scorp_payroll_cost_low + p.scorp_payroll_cost_high) * HALF
    const stateFranchise = profile.state === 'CA'
      ? Math.max(c.ca_franchise_min, profit * c.ca_scorp_franchise_rate)
      : 0

    // QBI: sole-prop base = profit − ½·SE tax; S-corp base excludes salary and
    // the employer FICA half. The lost deduction × marginal rate reduces savings.
    const qbiBaseSoleProp = profit - seTax * HALF
    const qbiBaseScorp = profit - salary - fica * HALF
    const qbiDeductionLost = Math.max(0, (qbiBaseSoleProp - qbiBaseScorp) * c.qbi_deduction_rate)
    const qbiTaxImpact = qbiDeductionLost * p.assumed_marginal_rate

    const netSavings = grossSavings - payrollCost - stateFranchise - qbiTaxImpact

    if (netSavings < p.scorp_min_savings) {
      return notApplicable(this,
        `Estimated net savings ${usd(netSavings)} is below the ${usd(p.scorp_min_savings)} bar after overhead`)
    }

    const math: MathLine[] = [
      { label: 'Current SE tax', formula: `${usd(profit)} × ${c.se_earnings_factor * 100}% × 15.3% (SS capped at ${usd(c.ss_wage_base)})`, valueUsd: -seTax },
      { label: `Payroll FICA on ${usd(salary)} reasonable salary`, formula: `${usd(salary)} × 15.3%`, valueUsd: fica },
      { label: 'Gross SE-tax savings', formula: `${usd(seTax)} − ${usd(fica)}`, valueUsd: grossSavings },
      { label: 'Payroll service cost', formula: `${usd(p.scorp_payroll_cost_low)}–${usd(p.scorp_payroll_cost_high)}/yr (midpoint)`, valueUsd: -payrollCost },
      ...(stateFranchise > 0
        ? [{ label: 'CA franchise tax', formula: `max(${usd(c.ca_franchise_min)}, ${c.ca_scorp_franchise_rate * 100}% × ${usd(profit)})`, valueUsd: -stateFranchise }]
        : []),
      { label: 'Reduced QBI deduction impact', formula: `${usd(qbiDeductionLost)} lost deduction × ${p.assumed_marginal_rate * 100}% marginal rate`, valueUsd: -qbiTaxImpact },
      { label: 'Estimated net annual savings', formula: 'gross − overhead − state − QBI impact', valueUsd: netSavings },
    ]

    // Form 2553: March 15 for current-year effect.
    const now = new Date()
    const pastDeadline =
      now.getUTCMonth() > FORM_2553_MONTH_IDX ||
      (now.getUTCMonth() === FORM_2553_MONTH_IDX && now.getUTCDate() > FORM_2553_DAY)
    const deadlineYear = pastDeadline ? now.getUTCFullYear() + FULL : now.getUTCFullYear()
    const deadline = `${deadlineYear}-03-15`

    return {
      kind: 'recommendation',
      ruleId: this.id,
      ruleVersion: this.version,
      title: this.title,
      rationale:
        `With ${usd(profit)} of net self-employment profit, an S-corp election with a ` +
        `${usd(salary)} reasonable salary shifts the remaining profit out of self-employment tax. ` +
        `After payroll costs${stateFranchise > 0 ? ', state franchise tax' : ''} and the reduced ` +
        `QBI deduction, the estimated net saving is about ${usd(netSavings)} per year.`,
      estimatedAnnualBenefitUsd: Math.round(netSavings),
      math,
      actionSteps: [
        'Discuss "reasonable compensation" for your role and region with a CPA',
        `File Form 2553 by ${deadline} for current-year effect (late-election relief may exist — ask, don't assume)`,
        'Set up payroll (service or accountant) before the first salary run',
        'Revisit Solo 401(k) contributions — employer contributions become 25% of W-2 salary only',
      ],
      deadline,
      counterIndications: [
        'IRS scrutinizes "reasonable compensation" that is too low relative to profit',
        'Some states tax S-corps punitively — verify your state before electing',
        'Large planned Solo 401(k) employer contributions are capped by the W-2 salary (see the Solo 401(k) card)',
        'QBI deduction shrinks on the salary portion — reflected in the math above, but verify your bracket',
      ],
    }
  },
}
