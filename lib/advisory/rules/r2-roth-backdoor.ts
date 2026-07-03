/**
 * R2 — Roth IRA / Backdoor Roth.
 *
 * 2026 limits from tax_constants (the source list had 2023 numbers).
 * Backdoor advice is GATED on the pro-rata trap: a pre-tax traditional IRA
 * balance makes conversions partly taxable — roll it into a Solo 401(k)
 * first (cross-reference R6).
 */

import {
  type AdvisoryRule, type FinancialProfile, type TaxConstants, type KbParameters,
  type RuleVerdict, type MathLine,
  missingRequiredFields, notApplicable,
} from '../types'

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

const CATCHUP_AGE = 50

function emergencyTargetMonths(profile: FinancialProfile, p: KbParameters): number {
  switch (profile.income_stability) {
    case 'self_employed': return p.emergency_months_self_employed
    case 'variable':      return p.emergency_months_family
    default:              return p.emergency_months_w2
  }
}

export const r2RothBackdoor: AdvisoryRule = {
  id: 'r2_roth_backdoor',
  version: 1,
  title: 'Unfilled Roth IRA room',
  requiredFields: [
    'filing_status', 'age_self', 'magi_estimate_usd', 'ytd_ira_contribution_usd',
    'liquid_cash_usd', 'monthly_essential_expenses_usd', 'income_stability',
    'traditional_ira_balance_usd',
  ],

  evaluate(profile: FinancialProfile, c: TaxConstants, p: KbParameters): RuleVerdict {
    const missing = missingRequiredFields(this, profile)
    if (missing.length) {
      return notApplicable(this, `Answer ${missing.length} question(s) to unlock this analysis`, missing)
    }

    const age = profile.age_self!
    const perPersonLimit = c.ira_limit + (age >= CATCHUP_AGE ? c.ira_catchup_50 : 0)
    const room = Math.max(0, perPersonLimit - profile.ytd_ira_contribution_usd!)
    if (room <= 0) {
      return notApplicable(this, 'This year’s IRA room is already filled')
    }

    // Cash beyond the emergency-fund target is the fundable amount.
    const targetMonths = emergencyTargetMonths(profile, p)
    const efTarget = targetMonths * profile.monthly_essential_expenses_usd!
    const available = profile.liquid_cash_usd! - efTarget
    if (available <= 0) {
      return notApplicable(this,
        `Emergency fund first: liquid cash is below the ${targetMonths}-month target (${usd(efTarget)})`)
    }
    const fundable = Math.min(room, available)

    const magi = profile.magi_estimate_usd!
    const isMfj = profile.filing_status === 'mfj'
    const phaseStart = isMfj ? c.roth_phaseout_mfj_start : c.roth_phaseout_single_start
    const phaseEnd = isMfj ? c.roth_phaseout_mfj_end : c.roth_phaseout_single_end

    const preTaxIra = profile.traditional_ira_balance_usd!
    const benefit = Math.round(fundable * p.roth_annual_drag_saved_rate)

    const math: MathLine[] = [
      { label: `IRA limit${age >= CATCHUP_AGE ? ' incl. catch-up' : ''}`, formula: `${usd(c.ira_limit)}${age >= CATCHUP_AGE ? ` + ${usd(c.ira_catchup_50)}` : ''}`, valueUsd: perPersonLimit },
      { label: 'Contributed year-to-date', formula: 'from your profile', valueUsd: -profile.ytd_ira_contribution_usd! },
      { label: 'Cash beyond emergency target', formula: `${usd(profile.liquid_cash_usd!)} − ${targetMonths}mo × ${usd(profile.monthly_essential_expenses_usd!)}`, valueUsd: available },
      { label: 'Fundable this year', formula: 'min(room, available cash)', valueUsd: fundable },
    ]

    // ── Direct Roth (below phase-out) ─────────────────────────────────────────
    if (magi < phaseStart) {
      return {
        kind: 'recommendation',
        ruleId: this.id, ruleVersion: this.version,
        title: `Fund your Roth IRA — ${usd(fundable)} of room available`,
        rationale:
          `Your MAGI estimate (${usd(magi)}) is below the ${usd(phaseStart)} phase-out, so a direct ` +
          `Roth contribution of up to ${usd(fundable)} is available. Roth dollars grow and withdraw tax-free.`,
        estimatedAnnualBenefitUsd: benefit,
        math,
        actionSteps: [
          `Contribute up to ${usd(fundable)} before the tax-filing deadline`,
          isMfj && profile.age_spouse != null ? 'A spousal IRA can double the household room — verify with your CPA' : 'Set up an automatic monthly contribution to fill the room',
        ].filter(Boolean) as string[],
        deadline: null,
        counterIndications: [
          'MAGI is an estimate — a raise or windfall could push you into the phase-out',
        ],
      }
    }

    // ── In the phase-out band ─────────────────────────────────────────────────
    if (magi <= phaseEnd) {
      return {
        kind: 'recommendation',
        ruleId: this.id, ruleVersion: this.version,
        title: 'Partial Roth room — you are inside the phase-out band',
        rationale:
          `MAGI ${usd(magi)} falls inside the ${usd(phaseStart)}–${usd(phaseEnd)} phase-out, so your ` +
          `direct Roth limit is reduced. A CPA can compute the exact reduced limit; contributing the ` +
          `excess via the backdoor route is also an option.`,
        estimatedAnnualBenefitUsd: benefit,
        math,
        actionSteps: ['Have a CPA compute the reduced limit before contributing'],
        deadline: null,
        counterIndications: [
          preTaxIra > 0
            ? `Pro-rata trap: your ${usd(preTaxIra)} pre-tax IRA makes any backdoor conversion partly taxable`
            : 'Recharacterize promptly if MAGI lands higher than estimated',
        ],
      }
    }

    // ── Above phase-out → backdoor, gated on pro-rata ─────────────────────────
    if (preTaxIra > 0) {
      return {
        kind: 'recommendation',
        ruleId: this.id, ruleVersion: this.version,
        title: 'Backdoor Roth available — but clear the pro-rata trap first',
        rationale:
          `MAGI ${usd(magi)} is above the ${usd(phaseEnd)} limit, so direct Roth is out — but the backdoor ` +
          `route stays open. Because you hold ${usd(preTaxIra)} in pre-tax traditional IRAs, a conversion ` +
          `today would be PARTLY TAXABLE under the pro-rata rule. Rolling the pre-tax balance into a ` +
          `Solo 401(k) first (see that card) clears the trap.`,
        estimatedAnnualBenefitUsd: benefit,
        math: [...math, { label: 'Pre-tax IRA balance (pro-rata input)', formula: 'from your profile', valueUsd: preTaxIra }],
        actionSteps: [
          'First: roll pre-tax traditional IRA balances into a Solo 401(k) (cross-referenced rule)',
          'Then: non-deductible traditional contribution → prompt Roth conversion',
          'File Form 8606 for the non-deductible basis',
        ],
        deadline: null,
        counterIndications: [
          'Pro-rata rule: conversions are taxed on the pre-tax fraction across ALL your IRAs as of Dec 31',
          'The step-transaction doctrine — leave reasonable time between steps per your CPA’s guidance',
        ],
      }
    }

    return {
      kind: 'recommendation',
      ruleId: this.id, ruleVersion: this.version,
      title: `Backdoor Roth — ${usd(fundable)} of room, no pro-rata exposure`,
      rationale:
        `MAGI ${usd(magi)} is above the ${usd(phaseEnd)} limit, and you hold no pre-tax IRA balances, ` +
        `so the backdoor route is clean: non-deductible traditional contribution, then convert.`,
      estimatedAnnualBenefitUsd: benefit,
      math,
      actionSteps: [
        `Contribute up to ${usd(fundable)} as a NON-deductible traditional IRA contribution`,
        'Convert to Roth promptly; file Form 8606',
      ],
      deadline: null,
      counterIndications: [
        'Opening any pre-tax IRA (e.g. a 401(k) rollover) before Dec 31 re-creates the pro-rata trap',
      ],
    }
  },
}
