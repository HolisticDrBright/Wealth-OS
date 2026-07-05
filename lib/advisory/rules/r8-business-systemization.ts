/**
 * R8 — Owner Dependency Audit (business systemization).
 *
 * COACHING grade, not calculated advice: it produces a qualitative framework
 * from the owner's own context, never a dollar figure. It carries
 * estimatedAnnualBenefitUsd = null and grade = 'coaching', so the engine keeps
 * it out of benefit totals and Monte Carlo and ranks it below every quantified
 * card.
 *
 * Trigger: a business entity is present AND net business profit > $0.
 *
 * Flow:
 *  - no business_context yet → the card asks the three CONTEXT questions.
 *  - context present → the Owner Dependency Audit (owner-dependent tasks vs
 *    system-dependent tasks disguised as owner work, the control hold, the
 *    highest-leverage release), plus an Operations Architect follow-up for the
 *    task the user selected (minimum viable process, who/what executes,
 *    quality standard, break point).
 */

import {
  type AdvisoryRule, type FinancialProfile, type TaxConstants, type KbParameters,
  type RuleVerdict, type BusinessContext,
  notApplicable,
} from '../types'

function hasContext(ctx: BusinessContext | null | undefined): ctx is BusinessContext {
  return !!ctx && (
    (ctx.weekly_owner_tasks?.length ?? 0) > 0 ||
    (ctx.failed_delegations?.length ?? 0) > 0 ||
    !!ctx.two_week_absence_breakage
  )
}

export const r8BusinessSystemization: AdvisoryRule = {
  id: 'r8_business_systemization',
  version: 1,
  title: 'Owner Dependency Audit',
  requiredFields: ['business_entity', 'net_business_profit_usd'],

  evaluate(profile: FinancialProfile, _c: TaxConstants, _p: KbParameters): RuleVerdict {
    if (profile.business_entity == null || profile.net_business_profit_usd == null) {
      return notApplicable(this, 'Answer the business-profile questions to unlock this analysis',
        ['business_entity', 'net_business_profit_usd'])
    }
    if (profile.business_entity === 'none' || profile.net_business_profit_usd <= 0) {
      return notApplicable(this, 'No profitable business entity — this card is for business owners')
    }

    const ctx = profile.business_context ?? null

    if (!hasContext(ctx)) {
      // Ask the CONTEXT questions via the standard profile-question flow.
      return {
        kind: 'recommendation',
        grade: 'coaching',
        ruleId: this.id, ruleVersion: this.version,
        title: 'Owner Dependency Audit — tell us how the business runs',
        rationale:
          'The biggest hidden risk in an owner-operated business is that the owner IS the system. ' +
          'Before we map what to release, we need your context. This is coaching, not calculated ' +
          'advice — nothing here is a tax or dollar figure.',
        estimatedAnnualBenefitUsd: null,
        math: [],
        actionSteps: [
          'List the tasks you personally do every week (weekly_owner_tasks)',
          'List delegations that have failed before, and why if you know (failed_delegations)',
          'Describe what breaks if you are absent for two weeks (two_week_absence_breakage)',
        ],
        deadline: null,
        counterIndications: [
          'Coaching guidance — not calculated advice. It reflects your inputs, not a computation.',
        ],
      }
    }

    const selected = ctx.selected_task
    const actionSteps: string[] = [
      'OWNER-DEPENDENT vs SYSTEM-DEPENDENT: sort your weekly tasks into ones that genuinely need ' +
        'you (judgement, relationships, vision) vs ones that only feel like they do',
      'THE CONTROL HOLD: name the task you resist delegating most — that resistance usually marks ' +
        'the highest-leverage release',
      'HIGHEST-LEVERAGE RELEASE: pick ONE system-dependent-task-disguised-as-owner-work to systematize first',
    ]
    if (ctx.two_week_absence_breakage) {
      actionSteps.push(`Two-week-absence breakage you reported: "${ctx.two_week_absence_breakage}" — ` +
        'this is the failure the first process should prevent')
    }

    // Operations Architect follow-up for the selected task.
    if (selected) {
      actionSteps.push(
        `OPERATIONS ARCHITECT — for "${selected}": define the minimum viable process (fewest steps ` +
        'that still works), who/what executes it (person, tool, or rule), the quality standard ' +
        '(how you know it was done right), and the break point (when it should escalate back to you)')
    } else {
      actionSteps.push('Select ONE task above to generate its Operations Architect follow-up ' +
        '(process, owner, quality standard, break point)')
    }

    return {
      kind: 'recommendation',
      grade: 'coaching',
      ruleId: this.id, ruleVersion: this.version,
      title: selected
        ? `Owner Dependency Audit — systematize "${selected}"`
        : 'Owner Dependency Audit — release the highest-leverage task',
      rationale:
        'Some of what you do as the owner is genuine owner work; some is system work wearing an ' +
        'owner costume. Separating the two — and building a minimum viable process for the highest-' +
        'leverage release — is how the business stops depending on you being in the room. This is ' +
        'coaching, not a calculated dollar benefit.',
      estimatedAnnualBenefitUsd: null,
      math: [],
      actionSteps,
      deadline: null,
      counterIndications: [
        'Coaching guidance — not calculated advice, not a tax or dollar computation.',
        'Systematizing changes operations; review employment/contractor and liability implications ' +
          'with the appropriate professional.',
      ],
    }
  },
}
