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
import { ADVISORY_DISCLAIMER, type FinancialProfile } from '@/lib/advisory/types'
import { rankNextDollar, type NextDollarPlan } from '@/lib/advisory/next-dollar'
import { buildQualityLabel, splitInputs, type DataQualityLabel } from '@/lib/advisory/data-quality'
import { tierCapForInvestable } from '@/lib/advisory/sweep-engine'

export interface CheckupItem {
  id: string
  title: string
  status: 'ok' | 'action' | 'needs_data' | 'info'
  summary: string
  quality: DataQualityLabel
}

export interface WealthCheckup {
  items: CheckupItem[]
  nextDollar: NextDollarPlan
  missingData: string[]
  disclaimer: string
  error?: string
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

    const taxVerifiedAt = (constantMetaRes[0]?.verified_at as string | undefined) ?? null
    const yieldsFetchedAt = yields?.fetchedAt ?? null

    const items: CheckupItem[] = []
    const missingData: string[] = []

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
        items.push({
          id: 'emergency_fund', title: 'Emergency fund', status: 'needs_data',
          summary: `Add ${missing.join(' and ')} to size the ${months}-month target.`, quality,
        })
        missingData.push(...missing)
      } else if (profile.liquid_cash_usd < emergencyTarget) {
        items.push({
          id: 'emergency_fund', title: 'Emergency fund', status: 'action',
          summary: `$${Math.round(emergencyTarget - profile.liquid_cash_usd).toLocaleString()} below the ${months}-month target ($${Math.round(emergencyTarget).toLocaleString()}).`,
          quality,
        })
      } else {
        items.push({
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
        items.push({
          id: 'idle_cash', title: 'Idle cash above the emergency target', status: 'action',
          summary: `~$${Math.round(idleCash).toLocaleString()} beyond the emergency target. T-bill ~${(yields?.tbill3moPct ?? 0).toFixed(2)}% / HYSA national avg ~${(yields?.savingsNationalAvgPct ?? 0).toFixed(2)}% — verify current rates before moving.`,
          quality,
        })
      } else if (cashAssets === 0) {
        items.push({
          id: 'idle_cash', title: 'Idle cash', status: 'needs_data',
          summary: 'No cash assets tracked — link or add cash balances to check for idle cash.', quality,
        })
        missingData.push('cash account balances')
      } else {
        items.push({
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
          items.push({ id: ruleId, title, status: 'action', summary: v.rationale.slice(0, 220), quality })
        } else if (v.kind === 'not_applicable' && v.missingFields?.length) {
          items.push({
            id: ruleId, title, status: 'needs_data',
            summary: `Answer ${v.missingFields.length} profile question(s) to evaluate: ${v.missingFields.join(', ')}.`,
            quality,
          })
          missingData.push(...v.missingFields)
        } else {
          items.push({
            id: ruleId, title, status: 'info',
            summary: v.kind === 'contraindicated' ? v.reason : (v as { reason?: string }).reason ?? 'Not applicable per the current profile.',
            quality,
          })
        }
      }
    } else {
      items.push({
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
        items.push({
          id: 'tlh', title: 'Tax-loss harvesting', status: 'action',
          summary: `${candidates.length} candidate(s), ~$${Math.round(totalLoss).toLocaleString()} in harvestable losses${candidates.some(c => c.wash_sale_risk) ? ' — some carry wash-sale risk; review each lot' : ''}. Requires CPA review.`,
          quality,
        })
      } else {
        items.push({
          id: 'tlh', title: 'Tax-loss harvesting', status: 'ok',
          summary: 'No pending harvest candidates.', quality,
        })
      }

      const blocked = washRes as Array<{ symbol: string; blocked_until: string }>
      if (blocked.length > 0) {
        items.push({
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
        items.push({
          id: 'rebalance', title: 'Rebalancing', status: 'action',
          summary: `${pending.length} pending suggestion(s): ${pending.slice(0, 3).map(p => `${p.action} ${p.asset_class} $${Math.round(p.suggested_notional).toLocaleString()}`).join('; ')}.`,
          quality,
        })
      } else {
        items.push({
          id: 'rebalance', title: 'Rebalancing', status: 'ok',
          summary: 'Portfolio within drift bands (or no suggestions computed yet).', quality,
        })
      }
    }

    // ── Debt payoff (no debt data collected yet — say so) ──────────────────────
    items.push({
      id: 'debt', title: 'Debt payoff', status: 'needs_data',
      summary: 'No debt balances or APRs are collected yet. Debt above the payoff hurdle beats investing — add debt data to rank it.',
      quality: buildQualityLabel({
        presentInputs: [], missingInputs: ['debt balances and APRs'], requiresProfessionalReview: false,
      }),
    })
    missingData.push('debt balances and APRs')

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
      employerMatchAvailable: null,   // not collected yet — stays needs_data
      highInterestDebtAprPct: null,   // not collected yet
      highInterestDebtBalanceUsd: null,
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

    missingData.push('employer 401(k) match details')

    return {
      items,
      nextDollar,
      missingData: [...new Set(missingData)],
      disclaimer: ADVISORY_DISCLAIMER,
    }
  } catch (err) {
    return emptyCheckup(err instanceof Error ? err.message : String(err))
  }
}

function emptyCheckup(error: string): WealthCheckup {
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
    error,
  }
}
