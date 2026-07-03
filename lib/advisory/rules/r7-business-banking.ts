/**
 * R7 — Business banking hygiene.
 *
 * Commingling personal and business funds pierces liability protection and
 * makes audits painful. Recommends CATEGORIES with rotating options — never
 * a hardcoded "best" provider.
 */

import {
  type AdvisoryRule, type FinancialProfile, type TaxConstants, type KbParameters,
  type RuleVerdict,
  missingRequiredFields, notApplicable,
} from '../types'

export const r7BusinessBanking: AdvisoryRule = {
  id: 'r7_business_banking',
  version: 1,
  title: 'Separate business banking missing',
  requiredFields: ['business_entity', 'has_separate_business_bank'],

  evaluate(profile: FinancialProfile, _c: TaxConstants, _p: KbParameters): RuleVerdict {
    const missing = missingRequiredFields(this, profile)
    if (missing.length) {
      return notApplicable(this, `Answer ${missing.length} question(s) to unlock this analysis`, missing)
    }
    if (profile.business_entity === 'none') {
      return notApplicable(this, 'No business entity on file')
    }
    if (profile.has_separate_business_bank) {
      return notApplicable(this, 'Business banking already separated')
    }

    return {
      kind: 'recommendation',
      ruleId: this.id, ruleVersion: this.version,
      title: 'Separate your business banking now',
      rationale:
        'Commingling personal and business funds is the classic way an LLC’s liability shield gets ' +
        'pierced in court, and it turns every audit into archaeology. Three accounts fix it: business ' +
        'checking, a business card, and bookkeeping software. Options shown on this card refresh ' +
        'quarterly — none is an endorsement.',
      estimatedAnnualBenefitUsd: null,
      math: [],
      actionSteps: [
        'Open a dedicated business checking account (EIN + formation docs needed)',
        'Move all business income and expenses to it; pay yourself by transfer',
        'Add a business credit card for expense separation and records',
        'Connect bookkeeping software to both',
      ],
      deadline: null,
      counterIndications: [
        'Historical commingled transactions should be reconstructed with your bookkeeper before tax season',
      ],
    }
  },
}
