/**
 * Advisory rules engine — evaluates all rules against a profile and ranks
 * recommendations by estimated annual benefit.
 *
 * Pure: (profile, constants, params) in → verdicts out. Persistence (advisory_log)
 * and rendering live in the server-action layer.
 */

import type { FinancialProfile, TaxConstants, KbParameters, RuleVerdict, AdvisoryRule } from './types'
import { r1ScorpElection } from './rules/r1-scorp-election'
import { r2RothBackdoor } from './rules/r2-roth-backdoor'
import { r3EmergencyFund } from './rules/r3-emergency-fund'
import { r4Hsa } from './rules/r4-hsa'
import { r5BusinessDeductions } from './rules/r5-business-deductions'
import { r6Solo401k } from './rules/r6-solo-401k'
import { r7BusinessBanking } from './rules/r7-business-banking'
import { r8BusinessSystemization } from './rules/r8-business-systemization'

export const ALL_ADVISORY_RULES: AdvisoryRule[] = [
  r1ScorpElection,
  r2RothBackdoor,
  r3EmergencyFund,
  r4Hsa,
  r5BusinessDeductions,
  r6Solo401k,
  r7BusinessBanking,
  r8BusinessSystemization,
]

/** A recommendation's grade, defaulting to 'quantified' for the r1–r7 rules. */
export function gradeOf(r: { grade?: 'quantified' | 'coaching' }): 'quantified' | 'coaching' {
  return r.grade ?? 'quantified'
}

export interface AdvisoryEvaluation {
  verdicts: RuleVerdict[]
  /** Recommendations only, ranked by estimated benefit (desc, nulls last). */
  recommendations: Extract<RuleVerdict, { kind: 'recommendation' }>[]
  /** Sum of quantified benefits across active recommendations. */
  totalEstimatedAnnualBenefitUsd: number
}

export function evaluateAllRules(
  profile: FinancialProfile,
  constants: TaxConstants,
  params: KbParameters
): AdvisoryEvaluation {
  const verdicts: RuleVerdict[] = []
  for (const rule of ALL_ADVISORY_RULES) {
    try {
      verdicts.push(rule.evaluate(profile, constants, params))
    } catch (err) {
      // A rule crash must never take down the advisory surface — log and skip.
      console.error(`[advisory] rule ${rule.id} threw:`, err)
      verdicts.push({
        kind: 'not_applicable',
        ruleId: rule.id,
        ruleVersion: rule.version,
        reason: 'Rule evaluation failed — see server logs',
      })
    }
  }

  const recommendations = verdicts
    .filter((v): v is Extract<RuleVerdict, { kind: 'recommendation' }> => v.kind === 'recommendation')
    // Coaching cards ALWAYS rank below quantified cards, regardless of any
    // estimated benefit; within a grade, by benefit desc (nulls last).
    .sort((a, b) => {
      const ga = gradeOf(a) === 'coaching' ? 1 : 0
      const gb = gradeOf(b) === 'coaching' ? 1 : 0
      if (ga !== gb) return ga - gb
      return (b.estimatedAnnualBenefitUsd ?? -1) - (a.estimatedAnnualBenefitUsd ?? -1)
    })

  // Coaching cards NEVER contribute to the benefit total (they are not
  // calculated advice); quantified cards only.
  const totalEstimatedAnnualBenefitUsd = recommendations
    .filter(r => gradeOf(r) === 'quantified')
    .reduce((s, r) => s + (r.estimatedAnnualBenefitUsd ?? 0), 0)

  return { verdicts, recommendations, totalEstimatedAnnualBenefitUsd }
}
