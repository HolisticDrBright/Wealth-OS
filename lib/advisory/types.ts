/**
 * Advisory rules engine — shared types.
 *
 * Rules are pure functions: (profile, constants, params) → verdict.
 * The LLM writes explanations FROM the rule's computed numbers;
 * the LLM never computes the numbers.
 *
 * Compliance: everything renders as education, not individualized tax/legal
 * advice. Every recommendation carries the disclaimer and a CPA CTA, and is
 * logged to advisory_log with the profile snapshot + rule version.
 */

export interface FinancialProfile {
  filing_status: 'single' | 'mfj' | 'mfs' | 'hoh' | null
  age_self: number | null
  age_spouse: number | null
  state: string | null
  business_entity: 'none' | 'sole_prop' | 'llc' | 'llc_scorp' | 'scorp' | 'ccorp' | 'partnership' | null
  net_business_profit_usd: number | null
  w2_wages_usd: number | null
  prior_year_wages_usd: number | null
  magi_estimate_usd: number | null
  health_plan_type: 'hdhp' | 'ppo' | 'hmo' | 'none' | 'other' | null
  monthly_essential_expenses_usd: number | null
  liquid_cash_usd: number | null
  income_stability: 'stable_w2' | 'variable' | 'self_employed' | null
  has_employees: boolean | null
  spouse_only_employee: boolean | null
  traditional_ira_balance_usd: number | null
  ytd_401k_employee_usd: number | null
  ytd_ira_contribution_usd: number | null
  ytd_hsa_contribution_usd: number | null
  has_separate_business_bank: boolean | null
  home_office_sqft: number | null
  business_miles_annual: number | null
  /**
   * Free-form business coaching context (jsonb) — answers to the Owner
   * Dependency Audit questions. Optional; absent → the coaching card prompts
   * for it. NEVER used in any dollar/tax computation or Monte Carlo.
   */
  business_context?: BusinessContext | null
}

export interface BusinessContext {
  /** Tasks the owner personally does each week. */
  weekly_owner_tasks?: string[]
  /** Delegations that have failed before (and why, if known). */
  failed_delegations?: string[]
  /** What breaks if the owner is absent for two weeks. */
  two_week_absence_breakage?: string
  /** The single task the user selected for the Operations Architect follow-up. */
  selected_task?: string
}

/** Year-keyed constants from tax_constants; key → value. */
export type TaxConstants = Record<string, number>

/** kb_parameters; key → value. */
export type KbParameters = Record<string, number>

export interface MathLine {
  label: string
  /** Formula with the actual numbers substituted, e.g. "$150,000 × 92.35% × 15.3%". */
  formula: string
  valueUsd: number
}

export interface Recommendation {
  kind: 'recommendation'
  ruleId: string
  ruleVersion: number
  title: string
  /**
   * 'quantified' — computed dollar/tax math (r1–r7); may feed benefit totals
   * and Monte Carlo. 'coaching' — LLM/framework-guided qualitative guidance;
   * NEVER feeds benefit totals or Monte Carlo and always ranks below
   * quantified cards. Absent = 'quantified' (existing rules).
   */
  grade?: 'quantified' | 'coaching'
  /** Plain-language rationale — rendered as education, never advice. */
  rationale: string
  /** Computed benefit; null when genuinely unquantifiable. */
  estimatedAnnualBenefitUsd: number | null
  /** "Show the math" lines — every number computed by the rule, not the LLM. */
  math: MathLine[]
  actionSteps: string[]
  /** ISO date when action is time-bound (e.g. 2553 filing). */
  deadline: string | null
  /** Things a CPA must verify before acting. */
  counterIndications: string[]
}

export interface NotApplicable {
  kind: 'not_applicable'
  ruleId: string
  ruleVersion: number
  reason: string
  /** Profile fields whose absence blocked evaluation ("answer 2 questions…"). */
  missingFields?: string[]
}

export interface Contraindicated {
  kind: 'contraindicated'
  ruleId: string
  ruleVersion: number
  reason: string
}

export type RuleVerdict = Recommendation | NotApplicable | Contraindicated

export interface AdvisoryRule {
  id: string
  version: number
  title: string
  /** Profile fields the rule needs; missing → NotApplicable with missingFields. */
  requiredFields: Array<keyof FinancialProfile>
  evaluate(
    profile: FinancialProfile,
    constants: TaxConstants,
    params: KbParameters
  ): RuleVerdict
}

/** Standard disclaimer rendered with EVERY recommendation. */
export const ADVISORY_DISCLAIMER =
  'Educational analysis only — not individualized tax, legal, or investment advice. ' +
  'Confirm with a CPA or licensed advisor before acting.'

export function missingRequiredFields(
  rule: Pick<AdvisoryRule, 'requiredFields'>,
  profile: FinancialProfile
): Array<keyof FinancialProfile> {
  return rule.requiredFields.filter(f => profile[f] === null || profile[f] === undefined)
}

export function notApplicable(
  rule: Pick<AdvisoryRule, 'id' | 'version'>,
  reason: string,
  missingFields?: string[]
): NotApplicable {
  return { kind: 'not_applicable', ruleId: rule.id, ruleVersion: rule.version, reason, missingFields }
}

export function contraindicated(
  rule: Pick<AdvisoryRule, 'id' | 'version'>,
  reason: string
): Contraindicated {
  return { kind: 'contraindicated', ruleId: rule.id, ruleVersion: rule.version, reason }
}
