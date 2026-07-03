/**
 * R4 — HSA (the stealth retirement account).
 *
 * 2026 limits from tax_constants. CA/NJ don't conform to federal HSA
 * treatment — state-aware caveat. Non-HDHP users may get a lower-confidence
 * "consider an HDHP at open enrollment" card.
 */

import {
  type AdvisoryRule, type FinancialProfile, type TaxConstants, type KbParameters,
  type RuleVerdict,
  missingRequiredFields, notApplicable,
} from '../types'

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

const HSA_CATCHUP_AGE = 55
const NONCONFORMING_STATES = ['CA', 'NJ']

export const r4Hsa: AdvisoryRule = {
  id: 'r4_hsa',
  version: 1,
  title: 'Unfilled HSA room',
  requiredFields: ['health_plan_type', 'filing_status', 'age_self', 'ytd_hsa_contribution_usd'],

  evaluate(profile: FinancialProfile, c: TaxConstants, p: KbParameters): RuleVerdict {
    const missing = missingRequiredFields(this, profile)
    if (missing.length) {
      return notApplicable(this, `Answer ${missing.length} question(s) to unlock this analysis`, missing)
    }

    // Not on an HDHP → lower-confidence consideration card, not a directive.
    if (profile.health_plan_type !== 'hdhp') {
      if (profile.health_plan_type === 'none') {
        return notApplicable(this, 'No health plan on file')
      }
      return {
        kind: 'recommendation',
        ruleId: this.id, ruleVersion: this.version,
        title: 'Consider an HDHP at open enrollment (lower confidence)',
        rationale:
          'Only HDHP members can fund an HSA — the one account that is tax-deductible going in, ' +
          'grows tax-free, and withdraws tax-free for medical costs. Whether an HDHP beats your ' +
          `current ${profile.health_plan_type?.toUpperCase()} depends on premiums vs. deductible risk — compare at open enrollment.`,
        estimatedAnnualBenefitUsd: null,
        math: [],
        actionSteps: [
          'At open enrollment, compare premium savings vs. the higher deductible against your typical usage',
          'If you switch, fund the HSA and invest it rather than spending it',
        ],
        deadline: null,
        counterIndications: [
          'High expected medical usage often favors a lower-deductible plan — run YOUR numbers',
        ],
      }
    }

    // Coverage tier: family limits for mfj/hoh (verify actual coverage with CPA).
    const family = profile.filing_status === 'mfj' || profile.filing_status === 'hoh'
    const baseLimit = family ? c.hsa_limit_family : c.hsa_limit_single
    const catchup = (profile.age_self ?? 0) >= HSA_CATCHUP_AGE ? c.hsa_catchup_55 : 0
    const limit = baseLimit + catchup
    const room = Math.max(0, limit - (profile.ytd_hsa_contribution_usd ?? 0))

    if (room <= 0) {
      return notApplicable(this, 'This year’s HSA room is already filled')
    }

    const benefit = Math.round(room * p.assumed_marginal_rate)
    const stateCaveat = profile.state && NONCONFORMING_STATES.includes(profile.state)

    return {
      kind: 'recommendation',
      ruleId: this.id, ruleVersion: this.version,
      title: `Fill your HSA — ${usd(room)} of triple-tax-free room`,
      rationale:
        `The HSA is the only triple-tax-advantaged account: deductible in, tax-free growth, tax-free ` +
        `out for medical costs. Invest it instead of spending it, archive receipts, and reimburse ` +
        `yourself years later — the classic stealth-retirement move.`,
      estimatedAnnualBenefitUsd: benefit,
      math: [
        { label: `${family ? 'Family' : 'Self-only'} limit${catchup ? ' incl. 55+ catch-up' : ''}`, formula: `${usd(baseLimit)}${catchup ? ` + ${usd(catchup)}` : ''}`, valueUsd: limit },
        { label: 'Contributed year-to-date', formula: 'from your profile', valueUsd: -(profile.ytd_hsa_contribution_usd ?? 0) },
        { label: 'Estimated tax saved', formula: `${usd(room)} × ${p.assumed_marginal_rate * 100}% marginal rate`, valueUsd: benefit },
      ],
      actionSteps: [
        `Contribute the remaining ${usd(room)} before the tax-filing deadline`,
        'Invest the balance (index funds) — don’t leave it in cash',
        'Archive medical receipts for future tax-free reimbursement',
      ],
      deadline: null,
      counterIndications: [
        ...(stateCaveat ? [`${profile.state} does not conform to federal HSA treatment — state tax still applies`] : []),
        'Confirm your actual coverage tier (self-only vs family) — limits differ',
      ],
    }
  },
}
