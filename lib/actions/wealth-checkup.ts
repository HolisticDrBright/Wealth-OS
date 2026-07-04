'use server'

/**
 * Wealth-management checkup (validation item 9) — the "regular person
 * building wealth" view: emergency fund, idle cash, contribution waterfall,
 * account prompts, cash-yield opportunities, tax-loss harvesting, wash-sale
 * warnings, rebalance suggestions, debt, and — explicitly — the data still
 * missing for better guidance.
 *
 * HONESTY CONTRACT: every item carries a DataQualityLabel (item 10). No
 * "loophole" language; everything is educational planning that requires
 * CPA/advisor review. Missing data produces a needs_data item, never a
 * confident guess.
 */

import { createClient } from '@/lib/supabase/server'
import { loadTaxConstants, loadKbParameters } from '@/lib/advisory/constants'
import { fetchCurrentYields } from '@/lib/advisory/yields'
import { evaluateAllRules } from '@/lib/advisory/engine'
import { getFinancialProfile } from '@/lib/actions/advisory'
import { getEmployerBenefits, getDebtAccounts } from '@/lib/actions/benefits-debt'
import { summarizeDebts, matchCaptureStatus } from '@/lib/advisory/benefits-debt'
import { ADVISORY_DISCLAIMER, type FinancialProfile } from '@/lib/advisory/types'
import { rankNextDollar, type NextDollarPlan, type NextDollarStep } from '@/lib/advisory/next-dollar'
import { buildQualityLabel, splitInputs, type DataQualityLabel } from '@/lib/advisory/data-quality'
import {
  buildGovernanceStamp, evaluateStaleness, buildSuitabilityFile,
  WEALTH_CHECKUP_RULE_VERSION,
  type Explanation, type GovernanceStamp, type StalenessVerdict, type SuitabilityFile,
} from '@/lib/advisory/suitability'
import { tierCapForInvestable } from '@/lib/advisory/sweep-engine'

export interface CheckupItem {
  id: string
  title: string
  status: 'ok' | 'action' | 'needs_data' | 'info'
  summary: string
  quality: DataQualityLabel
  /** Client-facing expandable explanation (item 9). */
  explanation: Explanation
}

export interface WealthCheckup {
  items: CheckupItem[]
  nextDollar: NextDollarPlan
  missingData: string[]
  disclaimer: string
  /** Model governance (item 8): what produced this checkup, and staleness. */
  governance: GovernanceStamp
  staleness: StalenessVerdict
  /** Suitability file (item 3) for the best-next-dollar recommendation. */
  bestNextSuitability: SuitabilityFile | null
  error?: string
}

/** Standard explanation scaffolding from an item's quality label. */
function explain(args: {
  whyNow: string
  whatCouldGoWrong: string
  quality: DataQualityLabel
  dataUsed: string[]
  whatToVerify: string
}): Explanation {
  return {
    whyNow: args.whyNow,
    whatCouldGoWrong: args.whatCouldGoWrong,
    dataUsed: args.dataUsed,
    missingData: args.quality.missingInputs,
    whatToVerify: args.whatToVerify,
    professionalReviewNeeded: args.quality.requiresProfessionalReview,
  }
}

export async function getWealthCheckup(): Promise<WealthCheckup> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return emptyCheckup('not signed in')

  try {
    const [profileLoaded, constants, params, yields] = await Promise.all([
      getFinancialProfile().catch(() => null),
      loadTaxConstants(supabase).catch(() => null),
      loadKbParameters(supabase).catch(() => null),
      fetchCurrentYields().catch(() => null),
    ])
    const profile = (profileLoaded ?? {}) as FinancialProfile

    const [harvestRes, washRes, rebalanceRes, assetsRes, constantMetaRes] = await Promise.all([
      supabase
        .from('harvest_candidates')
        .select('symbol, unrealized_loss_usd, wash_sale_risk')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .limit(50)
        .then(r => r.data ?? [], () => []),
      supabase
        .from('wash_sale_blocklist')
        .select('symbol, blocked_until')
        .eq('user_id', user.id)
        .gte('blocked_until', new Date().toISOString())
        .limit(50)
        .then(r => r.data ?? [], () => []),
      supabase
        .from('rebalance_suggestions')
        .select('asset_class, action, suggested_notional')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .limit(20)
        .then(r => r.data ?? [], () => []),
      supabase
        .from('assets')
        .select('category, current_value')
        .eq('user_id', user.id)
        .then(r => r.data ?? [], () => []),
      supabase
        .from('tax_constants')
        .select('verified_at')
        .order('verified_at', { ascending: false })
        .limit(1)
        .then(r => r.data ?? [], () => []),
    ])

    // First-class employer benefits + debt profile (upgrade item 2).
    const [benefits, debts] = await Promise.all([
      getEmployerBenefits().catch(() => null),
      getDebtAccounts().catch(() => [] as Awaited<ReturnType<typeof getDebtAccounts>>),
    ])
    const debtSummary = summarizeDebts(debts)
    const matchStatus = benefits ? matchCaptureStatus(benefits) : 'unknown'

    const taxVerifiedAt = (constantMetaRes[0]?.verified_at as string | undefined) ?? null
    const yieldsFetchedAt = yields?.fetchedAt ?? null

    const items: CheckupItem[] = []
    const missingData: string[] = []
    // Wraps push so every item carries an expandable explanation (item 9) —
    // a specific one when supplied, an honest generic scaffold otherwise.
    const addItem = (item: Omit<CheckupItem, 'explanation'> & { explanation?: Explanation }) => {
      items.push({
        ...item,
        explanation: item.explanation ?? explain({
          whyNow: item.status === 'action'
            ? item.summary
            : `Current status: ${item.summary}`,
          whatCouldGoWrong: item.status === 'needs_data'
            ? 'Guidance computed without this data may not apply to your situation at all.'
            : 'Inputs may be outdated or incomplete; rates and limits change; plan documents and state rules can override the general rule.',
          quality: item.quality,
          dataUsed: [
            'financial profile',
            ...(item.quality.ratesCurrent != null ? ['current cash yields'] : []),
            ...(item.quality.taxConstantsCurrent != null ? ['seeded tax constants'] : []),
          ],
          whatToVerify: item.quality.requiresProfessionalReview
            ? 'Review with a CPA or fiduciary advisor before acting; confirm current-year limits and your own plan documents.'
            : 'Verify balances and current rates before acting.',
        }),
      })
    }

    // ── Emergency fund ─────────────────────────────────────────────────────────
    const months = params
      ? (profile.income_stability === 'self_employed' ? params.emergency_months_self_employed
        : profile.income_stability === 'variable' ? params.emergency_months_family
        : params.emergency_months_w2) ?? 3
      : 3
    const emergencyTarget = profile.monthly_essential_expenses_usd != null
      ? profile.monthly_essential_expenses_usd * months
      : null
    {
      const { present, missing } = splitInputs(
        { liquid_cash_usd: profile.liquid_cash_usd, monthly_essential_expenses_usd: profile.monthly_essential_expenses_usd },
        { liquid_cash_usd: 'liquid cash balance', monthly_essential_expenses_usd: 'monthly essential expenses' }
      )
      const quality = buildQualityLabel({ presentInputs: present, missingInputs: missing, requiresProfessionalReview: false })
      if (profile.liquid_cash_usd == null || emergencyTarget == null) {
        addItem({
          id: 'emergency_fund', title: 'Emergency fund', status: 'needs_data',
          summary: `Add ${missing.join(' and ')} to size the ${months}-month target.`, quality,
        })
        missingData.push(...missing)
      } else if (profile.liquid_cash_usd < emergencyTarget) {
        addItem({
          id: 'emergency_fund', title: 'Emergency fund', status: 'action',
          summary: `$${Math.round(emergencyTarget - profile.liquid_cash_usd).toLocaleString()} below the ${months}-month target ($${Math.round(emergencyTarget).toLocaleString()}).`,
          quality,
        })
      } else {
        addItem({
          id: 'emergency_fund', title: 'Emergency fund', status: 'ok',
          summary: `Funded: $${Math.round(profile.liquid_cash_usd).toLocaleString()} vs $${Math.round(emergencyTarget).toLocaleString()} target.`,
          quality,
        })
      }
    }

    // ── Idle cash + cash-yield opportunity ─────────────────────────────────────
    const cashAssets = (assetsRes as Array<{ category: string; current_value: number }>)
      .filter(a => a.category === 'cash')
      .reduce((s, a) => s + (a.current_value ?? 0), 0)
    const idleCash = emergencyTarget != null ? Math.max(0, cashAssets - emergencyTarget) : null
    const bestYield = Math.max(yields?.tbill3moPct ?? 0, yields?.savingsNationalAvgPct ?? 0)
    {
      const quality = buildQualityLabel({
        presentInputs: cashAssets > 0 ? ['tracked cash assets'] : [],
        missingInputs: [
          ...(cashAssets === 0 ? ['tracked cash assets'] : []),
          ...(emergencyTarget == null ? ['emergency target (for the idle split)'] : []),
        ],
        usesRates: true,
        yieldsFetchedAt,
        requiresProfessionalReview: false,
      })
      if (idleCash != null && idleCash > 1000 && bestYield > 0) {
        addItem({
          id: 'idle_cash', title: 'Idle cash above the emergency target', status: 'action',
          summary: `~$${Math.round(idleCash).toLocaleString()} beyond the emergency target. T-bill ~${(yields?.tbill3moPct ?? 0).toFixed(2)}% / HYSA national avg ~${(yields?.savingsNationalAvgPct ?? 0).toFixed(2)}% — verify current rates before moving.`,
          quality,
        })
      } else if (cashAssets === 0) {
        addItem({
          id: 'idle_cash', title: 'Idle cash', status: 'needs_data',
          summary: 'No cash assets tracked — link or add cash balances to check for idle cash.', quality,
        })
        missingData.push('cash account balances')
      } else {
        addItem({
          id: 'idle_cash', title: 'Idle cash', status: 'ok',
          summary: 'No material cash above the emergency target.', quality,
        })
      }
    }

    // ── Advisory rules (Roth/backdoor, HSA, solo 401k) ─────────────────────────
    if (constants && params) {
      const evaluation = evaluateAllRules(profile, constants, params)
      for (const ruleId of ['r2_roth_backdoor', 'r4_hsa', 'r6_solo_401k'] as const) {
        const v = evaluation.verdicts.find(x => x.ruleId === ruleId)
        if (!v) continue
        const title = ruleId === 'r2_roth_backdoor' ? 'Roth IRA / backdoor Roth'
          : ruleId === 'r4_hsa' ? 'HSA' : 'Solo 401(k)'
        const quality = buildQualityLabel({
          presentInputs: v.kind === 'not_applicable' && v.missingFields?.length ? [] : ['financial profile'],
          missingInputs: v.kind === 'not_applicable' ? (v.missingFields ?? []) : [],
          usesTaxConstants: true,
          taxConstantsVerifiedAt: taxVerifiedAt,
          requiresProfessionalReview: true,
        })
        if (v.kind === 'recommendation') {
          addItem({ id: ruleId, title, status: 'action', summary: v.rationale.slice(0, 220), quality })
        } else if (v.kind === 'not_applicable' && v.missingFields?.length) {
          addItem({
            id: ruleId, title, status: 'needs_data',
            summary: `Answer ${v.missingFields.length} profile question(s) to evaluate: ${v.missingFields.join(', ')}.`,
            quality,
          })
          missingData.push(...v.missingFields)
        } else {
          addItem({
            id: ruleId, title, status: 'info',
            summary: v.kind === 'contraindicated' ? v.reason : (v as { reason?: string }).reason ?? 'Not applicable per the current profile.',
            quality,
          })
        }
      }
    } else {
      addItem({
        id: 'advisory_rules', title: 'Roth / HSA / 401(k) guidance', status: 'needs_data',
        summary: 'Tax constants or KB parameters unavailable — run the advisory migration/seed. No guidance is computed from missing constants.',
        quality: buildQualityLabel({
          presentInputs: [], missingInputs: ['tax constants', 'kb parameters'],
          usesTaxConstants: true, taxConstantsVerifiedAt: null, requiresProfessionalReview: true,
        }),
      })
    }

    // ── Tax-loss harvesting + wash-sale warnings ───────────────────────────────
    {
      const candidates = harvestRes as Array<{ symbol: string; unrealized_loss_usd: number; wash_sale_risk: boolean }>
      const totalLoss = candidates.reduce((s, c) => s + Math.abs(c.unrealized_loss_usd ?? 0), 0)
      const quality = buildQualityLabel({
        presentInputs: ['tracked positions'], missingInputs: [],
        usesTaxConstants: true, taxConstantsVerifiedAt: taxVerifiedAt, requiresProfessionalReview: true,
      })
      if (candidates.length > 0) {
        addItem({
          id: 'tlh', title: 'Tax-loss harvesting', status: 'action',
          summary: `${candidates.length} candidate(s), ~$${Math.round(totalLoss).toLocaleString()} in harvestable losses${candidates.some(c => c.wash_sale_risk) ? ' — some carry wash-sale risk; review each lot' : ''}. Requires CPA review.`,
          quality,
        })
      } else {
        addItem({
          id: 'tlh', title: 'Tax-loss harvesting', status: 'ok',
          summary: 'No pending harvest candidates.', quality,
        })
      }

      const blocked = washRes as Array<{ symbol: string; blocked_until: string }>
      if (blocked.length > 0) {
        addItem({
          id: 'wash_sale', title: 'Wash-sale windows', status: 'action',
          summary: `Repurchasing ${blocked.map(b => b.symbol).join(', ')} before the window ends would disallow harvested losses.`,
          quality,
        })
      }
    }

    // ── Rebalance suggestions ──────────────────────────────────────────────────
    {
      const pending = rebalanceRes as Array<{ asset_class: string; action: string; suggested_notional: number }>
      const quality = buildQualityLabel({
        presentInputs: ['tracked portfolio'], missingInputs: [], requiresProfessionalReview: false,
      })
      if (pending.length > 0) {
        addItem({
          id: 'rebalance', title: 'Rebalancing', status: 'action',
          summary: `${pending.length} pending suggestion(s): ${pending.slice(0, 3).map(p => `${p.action} ${p.asset_class} $${Math.round(p.suggested_notional).toLocaleString()}`).join('; ')}.`,
          quality,
        })
      } else {
        addItem({
          id: 'rebalance', title: 'Rebalancing', status: 'ok',
          summary: 'Portfolio within drift bands (or no suggestions computed yet).', quality,
        })
      }
    }

    // ── Debt payoff (first-class debt_accounts data, item 2) ───────────────────
    const debtHurdlePct = (params?.debt_payoff_hurdle_apr ?? 0.06) * 100
    if (debts.length === 0) {
      addItem({
        id: 'debt', title: 'Debt payoff', status: 'needs_data',
        summary: 'No debt accounts recorded. Debt above the payoff hurdle beats investing — add balances and APRs (or confirm you are debt-free).',
        quality: buildQualityLabel({
          presentInputs: [], missingInputs: ['debt balances and APRs'], requiresProfessionalReview: false,
        }),
      })
      missingData.push('debt balances and APRs')
    } else {
      const quality = buildQualityLabel({
        presentInputs: ['debt accounts'],
        missingInputs: debtSummary.missingAprCount > 0 ? [`APR on ${debtSummary.missingAprCount} debt(s)`] : [],
        requiresProfessionalReview: false,
      })
      if (debtSummary.highestApr && debtSummary.highestApr.aprPct > debtHurdlePct) {
        addItem({
          id: 'debt', title: 'Debt payoff', status: 'action',
          summary: `${debtSummary.highestApr.name} at ${debtSummary.highestApr.aprPct.toFixed(1)}% APR ($${Math.round(debtSummary.highestApr.balanceUsd).toLocaleString()}) exceeds the ${debtHurdlePct.toFixed(0)}% hurdle — paying it down is a risk-free return of the APR.`,
          quality,
        })
      } else {
        addItem({
          id: 'debt', title: 'Debt payoff', status: 'ok',
          summary: `${debtSummary.count} debt(s), $${Math.round(debtSummary.totalBalanceUsd).toLocaleString()} total — none above the ${debtHurdlePct.toFixed(0)}% hurdle.`,
          quality,
        })
      }
    }

    // ── Employer 401(k) match (item 2) ─────────────────────────────────────────
    {
      const quality = buildQualityLabel({
        presentInputs: matchStatus === 'unknown' ? [] : ['employer benefits'],
        missingInputs: matchStatus === 'unknown' ? ['employer match availability']
          : matchStatus === 'on_track_unknown' ? ['whether contributions are on track for the full match']
          : [],
        requiresProfessionalReview: false,
      })
      if (matchStatus === 'unknown') {
        addItem({
          id: 'employer_match', title: 'Employer 401(k) match', status: 'needs_data',
          summary: 'Unknown whether an employer match exists — it is a guaranteed 50–100% return when it does. Add your plan details.',
          quality,
        })
        missingData.push('employer 401(k) match details')
      } else if (matchStatus === 'unclaimed') {
        addItem({
          id: 'employer_match', title: 'Employer 401(k) match', status: 'action',
          summary: `Match available but not on track to capture it${benefits?.matchFormula ? ` (${benefits.matchFormula})` : ''}. Raise payroll deferrals to at least the match threshold.`,
          quality,
        })
      } else if (matchStatus === 'on_track_unknown') {
        addItem({
          id: 'employer_match', title: 'Employer 401(k) match', status: 'needs_data',
          summary: `Match exists${benefits?.matchFormula ? ` (${benefits.matchFormula})` : ''} — confirm whether current deferrals capture all of it.`,
          quality,
        })
      } else if (matchStatus === 'captured') {
        addItem({
          id: 'employer_match', title: 'Employer 401(k) match', status: 'ok',
          summary: 'On track to capture the full match.', quality,
        })
      } else {
        addItem({
          id: 'employer_match', title: 'Employer 401(k) match', status: 'info',
          summary: 'No employer match available.', quality,
        })
      }
    }

    // ── Next-dollar waterfall ──────────────────────────────────────────────────
    const investable = (assetsRes as Array<{ category: string; current_value: number }>)
      .reduce((s, a) => s + (a.current_value ?? 0), 0)
    const isMfj = profile.filing_status === 'mfj'
    const magi = profile.magi_estimate_usd
    let rothPath: 'direct' | 'backdoor' | 'ineligible' | null = null
    if (constants && magi != null && profile.filing_status != null) {
      const phaseStart = isMfj ? constants.roth_phaseout_mfj_start : constants.roth_phaseout_single_start
      const phaseEnd = isMfj ? constants.roth_phaseout_mfj_end : constants.roth_phaseout_single_end
      if (phaseStart != null && phaseEnd != null) {
        rothPath = magi < phaseStart ? 'direct' : 'backdoor'
      }
    }
    const hsaLimit = constants
      ? (profile.filing_status === 'mfj' ? constants.hsa_limit_family : constants.hsa_limit_single)
      : null

    const nextDollar = rankNextDollar({
      emergencyFundUsd: profile.liquid_cash_usd,
      emergencyTargetUsd: emergencyTarget,
      // Real first-class data (item 2): match capture status + highest-APR debt.
      employerMatchAvailable: matchStatus === 'unknown' ? null
        : matchStatus === 'none' ? false
        : matchStatus === 'unclaimed' || matchStatus === 'on_track_unknown',
      highInterestDebtAprPct: debts.length === 0 ? null : (debtSummary.highestApr?.aprPct ?? 0),
      highInterestDebtBalanceUsd: debtSummary.highestApr?.balanceUsd ?? 0,
      hsaEligible: profile.health_plan_type == null ? null : profile.health_plan_type === 'hdhp',
      hsaRemainingUsd: hsaLimit != null
        ? Math.max(0, hsaLimit - (profile.ytd_hsa_contribution_usd ?? 0))
        : null,
      rothPath,
      iraRemainingUsd: constants?.ira_limit != null
        ? Math.max(0, constants.ira_limit - (profile.ytd_ira_contribution_usd ?? 0))
        : null,
      employee401kRemainingUsd: constants?.solo401k_employee != null && profile.ytd_401k_employee_usd != null
        ? Math.max(0, constants.solo401k_employee - profile.ytd_401k_employee_usd)
        : null,
      tbillYieldPct: yields?.tbill3moPct ?? null,
      hysaYieldPct: yields?.savingsNationalAvgPct ?? null,
      debtPayoffHurdleAprPct: params?.debt_payoff_hurdle_apr ?? 0.06,
      speculativeSleeveCapFraction: params && investable > 0
        ? tierCapForInvestable(investable, params)
        : null,
      yieldsFetchedAt,
    })

    // ── Model governance (item 8) + suitability file for the top move (item 3) ─
    const governance = buildGovernanceStamp({
      ruleVersion: WEALTH_CHECKUP_RULE_VERSION,
      constantsYear: constants ? new Date().getUTCFullYear() : null,
      yieldsFetchedAt,
      profileUpdatedAt: null,   // financial_profile has updated_at; wire when exposed
    })
    const staleness = evaluateStaleness(governance)

    const bestNextSuitability = nextDollar.bestNext
      ? buildSuitabilityFile({
          recommendationType: 'next_dollar',
          recommendationId: nextDollar.bestNext.id,
          whatWeKnow: {
            'liquid cash': profile.liquid_cash_usd,
            'monthly essential expenses': profile.monthly_essential_expenses_usd,
            'employer match status': matchStatus,
            'highest debt APR': debtSummary.highestApr?.aprPct ?? (debts.length ? 'all below hurdle' : null),
            'HSA eligible': profile.health_plan_type == null ? null : profile.health_plan_type === 'hdhp',
            'MAGI estimate': profile.magi_estimate_usd,
          },
          whatWeDoNotKnow: [...new Set([...nextDollar.bestNext.missingInputs, ...missingData])],
          whyReasonable: `${nextDollar.bestNext.title} ranks first under the standard planner waterfall: ${nextDollar.bestNext.reason}`,
          whatCouldMakeThisWrong:
            'Unrecorded debts, an employer match we do not know about, imminent large expenses, or income changes would reorder the waterfall. Limits and rates also change each year.',
          whatToVerify:
            'Current-year contribution limits, plan match documents, actual APRs, and your full cash-flow picture — with a CPA or fiduciary advisor.',
          alternativesConsidered: nextDollar.steps.map(s => s.title),
          rejectedAlternatives: nextDollar.steps
            .filter(s => s.id !== nextDollar.bestNext!.id && s.status !== 'recommended')
            .map(s => ({ alternative: s.title, reason: `${s.status.replace('_', ' ')}: ${s.reason.slice(0, 140)}` })),
          riskProfileSnapshot: { income_stability: profile.income_stability ?? null },
          stamp: governance,
        })
      : null

    return {
      items,
      nextDollar,
      missingData: [...new Set(missingData)],
      disclaimer: ADVISORY_DISCLAIMER,
      governance,
      staleness,
      bestNextSuitability,
    }
  } catch (err) {
    return emptyCheckup(err instanceof Error ? err.message : String(err))
  }
}

/**
 * Persist the current best-next-dollar suitability file to
 * recommendation_files — the auditable fiduciary record (item 3).
 */
export async function fileBestNextSuitability(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not authenticated' }
  const checkup = await getWealthCheckup()
  const file = checkup.bestNextSuitability
  if (!file) return { ok: false, error: 'no recommended step to file' }
  const { error } = await supabase.from('recommendation_files').insert({
    user_id: user.id,
    recommendation_type: file.recommendationType,
    recommendation_id: file.recommendationId,
    facts_used: file.factsUsed,
    missing_facts: file.missingFacts,
    alternatives_considered: file.alternativesConsidered,
    rejected_alternatives: file.rejectedAlternatives,
    risk_profile_snapshot: file.riskProfileSnapshot,
    conflicts_disclosed: file.conflictsDisclosed,
    explanation: file.explanation,
    professional_review_required: file.professionalReviewRequired,
    rule_version: file.ruleVersion,
    constants_year: file.constantsYear,
    data_freshness: file.dataFreshness,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

function emptyCheckup(error: string): WealthCheckup {
  const governance = buildGovernanceStamp({ ruleVersion: WEALTH_CHECKUP_RULE_VERSION })
  return {
    items: [],
    nextDollar: rankNextDollar({
      emergencyFundUsd: null, emergencyTargetUsd: null, employerMatchAvailable: null,
      highInterestDebtAprPct: null, highInterestDebtBalanceUsd: null,
      hsaEligible: null, hsaRemainingUsd: null, rothPath: null, iraRemainingUsd: null,
      employee401kRemainingUsd: null, tbillYieldPct: null, hysaYieldPct: null,
      debtPayoffHurdleAprPct: 0.06, speculativeSleeveCapFraction: null, yieldsFetchedAt: null,
    }),
    missingData: [],
    disclaimer: ADVISORY_DISCLAIMER,
    governance,
    staleness: evaluateStaleness(governance),
    bestNextSuitability: null,
    error,
  }
}
