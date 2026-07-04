/**
 * "Best next dollar" (validation item 11) — a conservative, rules-based
 * ranking of where the next saved dollar should go. The canonical planner
 * waterfall, explainable line by line:
 *
 *   1. emergency fund to target
 *   2. employer match (never leave a guaranteed 50–100% return)
 *   3. high-interest debt above the payoff hurdle
 *   4. HSA (if HDHP-eligible)
 *   5. Roth IRA / backdoor Roth
 *   6. traditional 401(k) headroom
 *   7. taxable investing vs T-bill/HYSA cash reserve
 *   8. paper-trading bankroll — LAST, capped, educational only
 *
 * Pure function. It NEVER moves money; steps with missing inputs are shown
 * as needs_data instead of being confidently ranked. Educational planning —
 * requires CPA/advisor review before acting.
 */

import { buildQualityLabel, type DataQualityLabel } from './data-quality'

export interface NextDollarInputs {
  /** Current liquid emergency cash and its target. */
  emergencyFundUsd: number | null
  emergencyTargetUsd: number | null
  /** Is an unclaimed employer 401(k) match available? null = unknown. */
  employerMatchAvailable: boolean | null
  /** Highest-APR debt, if any is known. null = no data collected. */
  highInterestDebtAprPct: number | null
  highInterestDebtBalanceUsd: number | null
  /** HDHP enrollment → HSA eligibility. null = plan type unknown. */
  hsaEligible: boolean | null
  hsaRemainingUsd: number | null
  /** From the Roth/backdoor rule: how this household can reach a Roth. */
  rothPath: 'direct' | 'backdoor' | 'ineligible' | null
  iraRemainingUsd: number | null
  employee401kRemainingUsd: number | null
  /** Current cash yields (for the reserve step). */
  tbillYieldPct: number | null
  hysaYieldPct: number | null
  /** KB debt-payoff hurdle (APR above this beats expected market return). */
  debtPayoffHurdleAprPct: number
  /** Speculative sleeve cap fraction for this wealth tier. */
  speculativeSleeveCapFraction: number | null
  yieldsFetchedAt: string | null
}

export type NextDollarStatus = 'recommended' | 'satisfied' | 'needs_data' | 'not_applicable'

export interface NextDollarStep {
  rank: number
  id: string
  title: string
  status: NextDollarStatus
  reason: string
  missingInputs: string[]
  quality: DataQualityLabel
}

export interface NextDollarPlan {
  steps: NextDollarStep[]
  /** The single highest-ranked 'recommended' step, if any. */
  bestNext: NextDollarStep | null
  disclaimer: string
}

export const NEXT_DOLLAR_DISCLAIMER =
  'Educational planning only — a rules-based ordering, not personalized advice. ' +
  'Verify current rates and limits, and review with a CPA or fiduciary advisor before acting. ' +
  'Nothing here moves money.'

export function rankNextDollar(i: NextDollarInputs): NextDollarPlan {
  const steps: NextDollarStep[] = []
  let rank = 0

  const q = (present: string[], missing: string[], opts?: { rates?: boolean; cpa?: boolean }) =>
    buildQualityLabel({
      presentInputs: present,
      missingInputs: missing,
      usesRates: opts?.rates ?? false,
      yieldsFetchedAt: i.yieldsFetchedAt,
      requiresProfessionalReview: opts?.cpa ?? true,
    })

  const push = (id: string, title: string, status: NextDollarStatus, reason: string,
    present: string[], missing: string[], opts?: { rates?: boolean; cpa?: boolean }) => {
    steps.push({ rank: ++rank, id, title, status, reason, missingInputs: missing, quality: q(present, missing, opts) })
  }

  // 1 — emergency fund
  if (i.emergencyFundUsd == null || i.emergencyTargetUsd == null) {
    push('emergency_fund', 'Emergency fund', 'needs_data',
      'Cannot rank without the current fund balance and a months-of-expenses target.',
      [], ['liquid cash balance', 'monthly essential expenses'])
  } else if (i.emergencyFundUsd < i.emergencyTargetUsd) {
    const gap = i.emergencyTargetUsd - i.emergencyFundUsd
    push('emergency_fund', 'Emergency fund', 'recommended',
      `$${Math.round(gap).toLocaleString()} below target — this comes before every investment. Hold it in HYSA/T-bills, not the market.`,
      ['liquid cash balance', 'target'], [], { cpa: false })
  } else {
    push('emergency_fund', 'Emergency fund', 'satisfied',
      'At or above target.', ['liquid cash balance', 'target'], [], { cpa: false })
  }

  // 2 — employer match
  if (i.employerMatchAvailable == null) {
    push('employer_match', 'Employer 401(k) match', 'needs_data',
      'Unknown whether an unclaimed match exists — it is a guaranteed 50–100% return when it does.',
      [], ['employer match availability'])
  } else if (i.employerMatchAvailable) {
    push('employer_match', 'Employer 401(k) match', 'recommended',
      'Contribute at least enough to capture the full match — no investment beats a guaranteed match.',
      ['employer match availability'], [], { cpa: false })
  } else {
    push('employer_match', 'Employer 401(k) match', 'not_applicable',
      'No unclaimed employer match.', ['employer match availability'], [], { cpa: false })
  }

  // 3 — high-interest debt
  if (i.highInterestDebtAprPct == null) {
    push('high_interest_debt', 'High-interest debt payoff', 'needs_data',
      `No debt data collected. Debt above ~${(i.debtPayoffHurdleAprPct * 100).toFixed(0)}% APR beats expected market returns when paid down.`,
      [], ['debt balances and APRs'])
  } else if (i.highInterestDebtAprPct > i.debtPayoffHurdleAprPct * 100 && (i.highInterestDebtBalanceUsd ?? 0) > 0) {
    push('high_interest_debt', 'High-interest debt payoff', 'recommended',
      `${i.highInterestDebtAprPct.toFixed(1)}% APR exceeds the ${(i.debtPayoffHurdleAprPct * 100).toFixed(0)}% hurdle — paying it down is a risk-free return of the APR.`,
      ['debt APR', 'debt balance'], [], { cpa: false })
  } else {
    push('high_interest_debt', 'High-interest debt payoff', 'satisfied',
      'No debt above the payoff hurdle.', ['debt APR'], [], { cpa: false })
  }

  // 4 — HSA
  if (i.hsaEligible == null) {
    push('hsa', 'HSA contribution', 'needs_data',
      'Health plan type unknown — an HDHP unlocks the only triple-tax-advantaged account.',
      [], ['health plan type'])
  } else if (i.hsaEligible && (i.hsaRemainingUsd ?? 0) > 0) {
    push('hsa', 'HSA contribution', 'recommended',
      `$${Math.round(i.hsaRemainingUsd!).toLocaleString()} of HSA headroom left — deductible in, tax-free growth, tax-free out for medical.`,
      ['health plan type', 'YTD HSA contributions'], [])
  } else if (i.hsaEligible) {
    push('hsa', 'HSA contribution', 'satisfied', 'HSA limit reached for the year.',
      ['health plan type', 'YTD HSA contributions'], [])
  } else {
    push('hsa', 'HSA contribution', 'not_applicable', 'Not on an HDHP — no HSA eligibility.',
      ['health plan type'], [])
  }

  // 5 — Roth IRA / backdoor
  if (i.rothPath == null || i.iraRemainingUsd == null) {
    push('roth_ira', 'Roth IRA / backdoor Roth', 'needs_data',
      'Needs MAGI estimate, filing status, and YTD IRA contributions to determine the path.',
      [], ['MAGI estimate', 'filing status', 'YTD IRA contributions'])
  } else if (i.iraRemainingUsd <= 0) {
    push('roth_ira', 'Roth IRA / backdoor Roth', 'satisfied', 'IRA limit reached for the year.',
      ['MAGI', 'YTD IRA contributions'], [])
  } else if (i.rothPath === 'direct') {
    push('roth_ira', 'Roth IRA (direct)', 'recommended',
      `$${Math.round(i.iraRemainingUsd).toLocaleString()} of IRA headroom — under the MAGI limit, contribute directly.`,
      ['MAGI', 'YTD IRA contributions'], [])
  } else if (i.rothPath === 'backdoor') {
    push('roth_ira', 'Backdoor Roth IRA', 'recommended',
      `Over the direct MAGI limit; the backdoor route remains. PRO-RATA WARNING: existing pre-tax IRA balances make this taxable — requires CPA review before executing.`,
      ['MAGI', 'YTD IRA contributions'], [])
  } else {
    push('roth_ira', 'Roth IRA', 'not_applicable',
      'Neither direct nor backdoor path applies per the current profile.', ['MAGI'], [])
  }

  // 6 — traditional 401(k) headroom
  if (i.employee401kRemainingUsd == null) {
    push('trad_401k', 'Traditional 401(k) beyond the match', 'needs_data',
      'YTD employee deferrals unknown.', [], ['YTD 401(k) employee contributions'])
  } else if (i.employee401kRemainingUsd > 0) {
    push('trad_401k', 'Traditional 401(k) beyond the match', 'recommended',
      `$${Math.round(i.employee401kRemainingUsd).toLocaleString()} of employee-deferral headroom — pre-tax growth after the higher-priority buckets.`,
      ['YTD 401(k) contributions'], [])
  } else {
    push('trad_401k', 'Traditional 401(k)', 'satisfied', 'Employee deferral limit reached.',
      ['YTD 401(k) contributions'], [])
  }

  // 7 — taxable investing / cash reserve
  const bestCash = Math.max(i.tbillYieldPct ?? 0, i.hysaYieldPct ?? 0)
  push('taxable_or_cash', 'Taxable investing vs T-bill/HYSA reserve', 'recommended',
    bestCash > 0
      ? `Dollars needed within ~3 years belong in T-bills/HYSA (~${bestCash.toFixed(2)}% available); longer-horizon dollars go to diversified taxable investing.`
      : 'Dollars needed within ~3 years belong in T-bills/HYSA (current rates unavailable — verify before acting); longer-horizon dollars go to diversified taxable investing.',
    i.tbillYieldPct != null || i.hysaYieldPct != null ? ['current cash yields'] : [],
    i.tbillYieldPct == null && i.hysaYieldPct == null ? ['current cash yields'] : [],
    { rates: true, cpa: false })

  // 8 — paper-trading bankroll (always last, always capped)
  push('paper_bankroll', 'Paper-trading bankroll allocation', 'not_applicable',
    i.speculativeSleeveCapFraction != null
      ? `During the validation phase this stays PAPER — no real dollars. If strategies ever pass every gate, the speculative sleeve is capped at ${(i.speculativeSleeveCapFraction * 100).toFixed(0)}% of investable assets for your tier, and only after steps 1–7.`
      : 'During the validation phase this stays PAPER — no real dollars are allocated to strategies.',
    [], [], { cpa: false })

  const bestNext = steps.find(s => s.status === 'recommended') ?? null
  return { steps, bestNext, disclaimer: NEXT_DOLLAR_DISCLAIMER }
}
