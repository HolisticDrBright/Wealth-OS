/**
 * R9 — Income-Growth pillar (coaching card).
 *
 * The pure helpers (trigger, income-vs-allocation comparison, idea generator)
 * live in lib/advisory/income-growth.ts. This file holds only the engine rule
 * — the COACHING idea card — and re-exports the helpers for callers/tests.
 *
 * QUANTIFIED header (income-vs-allocation from the real Monte Carlo) is
 * composed in lib/actions/income-growth.ts; numbers there come from the
 * simulation, not the LLM. HARD RULE: a speculative income number never enters
 * the Monte Carlo unless the user converts an idea into a real profile income
 * change (the existing profile-edit flow).
 */

import {
  type AdvisoryRule, type FinancialProfile, type TaxConstants, type KbParameters,
  type RuleVerdict,
  notApplicable,
} from '../types'
import { generateIncomeIdeas } from '../income-growth'

export {
  incomeGrowthTriggered, compareIncomeVsAllocation, generateIncomeIdeas,
  type IncomeGrowthTriggerInput, type IncomeVsAllocation, type IncomeIdea,
} from '../income-growth'

export const r9IncomeGrowth: AdvisoryRule = {
  id: 'r9_income_growth',
  version: 1,
  title: 'Income growth',
  requiredFields: [],

  evaluate(profile: FinancialProfile, _c: TaxConstants, p: KbParameters): RuleVerdict {
    const w2 = profile.w2_wages_usd
    const biz = profile.net_business_profit_usd
    if (w2 == null && biz == null) {
      return notApplicable(this, 'Add your income to unlock the income-growth pillar', ['w2_wages_usd'])
    }
    const annualIncome = (w2 ?? 0) + (biz ?? 0)
    const ceiling = p.income_pillar_income_ceiling
    if (ceiling != null && annualIncome >= ceiling) {
      return notApplicable(this, 'At your income level, allocation and tax optimization still move the needle — the income pillar is lower priority')
    }

    const ideas = generateIncomeIdeas(profile)
    return {
      kind: 'recommendation',
      grade: 'coaching',
      ruleId: this.id, ruleVersion: this.version,
      title: 'Income growth — the highest-leverage lever at your level',
      rationale:
        'Below roughly mass-affluent investable, no allocation change moves your long-run wealth as much ' +
        'as earning more. These are coaching ideas, not calculated advice; a speculative income number ' +
        'only affects your plan if YOU convert it into a real income change in your profile.',
      estimatedAnnualBenefitUsd: null,
      math: [],
      actionSteps: ideas.map(i =>
        `${i.title} — ${i.description} [ease: ${i.ease} · speed: ${i.speed} · investment: ${i.requiredInvestment} · potential: ${i.profitPotential} · ${i.scalability}]`),
      deadline: null,
      counterIndications: [
        'Coaching guidance — not calculated advice. Idea income is illustrative and never enters your projections unless you record it as a real profile income change.',
      ],
    }
  },
}
