/**
 * R3 — Emergency fund.
 *
 * Target is profile-derived months of essential expenses (self-employed skews
 * long), never a flat dollar figure. Yield figures are LIVE (fetched by the
 * card renderer via lib/advisory/yields.ts) — never hardcoded here.
 */

import {
  type AdvisoryRule, type FinancialProfile, type TaxConstants, type KbParameters,
  type RuleVerdict,
  missingRequiredFields, notApplicable,
} from '../types'

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

export const r3EmergencyFund: AdvisoryRule = {
  id: 'r3_emergency_fund',
  version: 1,
  title: 'Emergency fund below target',
  requiredFields: ['monthly_essential_expenses_usd', 'liquid_cash_usd', 'income_stability'],

  evaluate(profile: FinancialProfile, _c: TaxConstants, p: KbParameters): RuleVerdict {
    const missing = missingRequiredFields(this, profile)
    if (missing.length) {
      return notApplicable(this, `Answer ${missing.length} question(s) to unlock this analysis`, missing)
    }

    const months =
      profile.income_stability === 'self_employed' ? p.emergency_months_self_employed
      : profile.income_stability === 'variable' ? p.emergency_months_family
      : p.emergency_months_w2

    const target = months * profile.monthly_essential_expenses_usd!
    const liquid = profile.liquid_cash_usd!
    const gap = target - liquid

    if (gap <= 0) {
      return notApplicable(this, `Funded: liquid reserves cover the ${months}-month target (${usd(target)})`)
    }

    const coreMonths = Math.min(months, p.emergency_months_w2)
    return {
      kind: 'recommendation',
      ruleId: this.id, ruleVersion: this.version,
      title: `Emergency fund is ${usd(gap)} short of target`,
      rationale:
        `With ${profile.income_stability === 'self_employed' ? 'self-employment income' : 'your income profile'}, ` +
        `the target is ${months} months of essential expenses (${usd(target)}). You hold ${usd(liquid)} — ` +
        `a ${usd(gap)} gap. Nothing enters any risk sleeve while this is unfunded. Current HYSA and ` +
        `T-bill yields are shown live on this card (T-bill interest is state-tax-free).`,
      estimatedAnnualBenefitUsd: null,  // depends on live yields — never hardcoded
      math: [
        { label: `Target (${months} months)`, formula: `${months} × ${usd(profile.monthly_essential_expenses_usd!)}`, valueUsd: target },
        { label: 'Liquid reserves', formula: 'from your profile', valueUsd: -liquid },
        { label: 'Gap to fund', formula: 'target − liquid', valueUsd: gap },
      ],
      actionSteps: [
        `Core (first ${coreMonths} months): high-yield savings or money-market — compare 3–4 current options`,
        'Above the core: a 4/8/13/26-week T-bill ladder (state-tax-free interest)',
        'Route new savings here before any investing or trading sleeve',
      ],
      deadline: null,
      counterIndications: [
        'Rates move — the options and APYs on this card refresh weekly and are not endorsements',
      ],
    }
  },
}
