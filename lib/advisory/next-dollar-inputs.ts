/**
 * ONE mapping from what we know about a household to the best-next-dollar
 * waterfall inputs (roadmap #1) — PURE. Used by the /advisor wealth checkup
 * AND the Home / phone "best next dollar" card, so they can never disagree.
 *
 * The emergency step uses the three-tier ladder's Tier 1 Safety (holdings vs
 * 6 months of essentials + goals due within 2 years) — the same cushion the
 * ladder panel, the Explore gate and the setup decision use. The older
 * definition (liquid_cash_usd vs expenses × kb months) is retired.
 */

import type { FinancialProfile, TaxConstants, KbParameters } from '@/lib/advisory/types'
import type { YieldSnapshot } from '@/lib/advisory/yields'
import type { Ladder } from '@/lib/allocation/ladder'
import { summarizeDebts, matchCaptureStatus, type EmployerBenefits, type DebtAccount } from '@/lib/advisory/benefits-debt'
import { tierCapForInvestable } from '@/lib/advisory/sweep-engine'
import type { NextDollarInputs } from '@/lib/advisory/next-dollar'

export interface NextDollarSources {
  profile: Partial<FinancialProfile>
  benefits: EmployerBenefits
  debts: DebtAccount[]
  /** The user said they have no high-interest debt (no debt rows needed). */
  noHighInterestDebtConfirmed: boolean
  constants: TaxConstants | null
  params: KbParameters | null
  yields: YieldSnapshot | null
  ladder: Ladder | null
  investableUsd: number
}

export function nextDollarInputsFrom(s: NextDollarSources): NextDollarInputs {
  const { profile, constants, params, yields, ladder } = s
  const matchStatus = matchCaptureStatus(s.benefits)
  const debtSummary = summarizeDebts(s.debts)

  // Roth path (direct vs backdoor) from MAGI + filing status + phase-out constants.
  const isMfj = profile.filing_status === 'mfj'
  const magi = profile.magi_estimate_usd ?? null
  let rothPath: 'direct' | 'backdoor' | 'ineligible' | null = null
  if (constants && magi != null && profile.filing_status != null) {
    const start = isMfj ? constants.roth_phaseout_mfj_start : constants.roth_phaseout_single_start
    const end = isMfj ? constants.roth_phaseout_mfj_end : constants.roth_phaseout_single_end
    if (start != null && end != null) rothPath = magi < start ? 'direct' : 'backdoor'
  }
  const hsaLimit = constants
    ? (profile.filing_status === 'mfj' ? constants.hsa_limit_family : constants.hsa_limit_single)
    : null

  // Debts: no rows means "unknown" unless the user told us there are none.
  const highestApr = s.debts.length === 0
    ? (s.noHighInterestDebtConfirmed ? 0 : null)
    : (debtSummary.highestApr?.aprPct ?? 0)

  const tier1Known = ladder != null && ladder.tier1.status !== 'needs_expenses' && ladder.tier1.targetUsd != null

  return {
    emergencyFundUsd: tier1Known ? ladder!.tier1.heldUsd : null,
    emergencyTargetUsd: tier1Known ? ladder!.tier1.targetUsd : null,
    employerMatchAvailable: matchStatus === 'unknown' ? null
      : matchStatus === 'none' ? false
      : matchStatus === 'unclaimed' || matchStatus === 'on_track_unknown',
    highInterestDebtAprPct: highestApr,
    highInterestDebtBalanceUsd: debtSummary.highestApr?.balanceUsd ?? 0,
    hsaEligible: profile.health_plan_type == null ? null : profile.health_plan_type === 'hdhp',
    hsaRemainingUsd: hsaLimit != null ? Math.max(0, hsaLimit - (profile.ytd_hsa_contribution_usd ?? 0)) : null,
    rothPath,
    iraRemainingUsd: constants?.ira_limit != null && profile.ytd_ira_contribution_usd != null
      ? Math.max(0, constants.ira_limit - profile.ytd_ira_contribution_usd)
      : null,
    employee401kRemainingUsd: constants?.solo401k_employee != null && profile.ytd_401k_employee_usd != null
      ? Math.max(0, constants.solo401k_employee - profile.ytd_401k_employee_usd)
      : null,
    tbillYieldPct: yields?.tbill3moPct ?? null,
    hysaYieldPct: yields?.savingsNationalAvgPct ?? null,
    debtPayoffHurdleAprPct: params?.debt_payoff_hurdle_apr ?? 0.06,
    speculativeSleeveCapFraction: params && s.investableUsd > 0 ? tierCapForInvestable(s.investableUsd, params) : null,
    yieldsFetchedAt: yields?.fetchedAt ?? null,
  }
}
