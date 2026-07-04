/**
 * Suitability files, model governance, and client-facing explanations
 * (upgrade items 3, 8, 9) — pure builders.
 *
 * Every major recommendation can produce an AUDITABLE record following the
 * fiduciary pattern: what we know / what we do not know / why this is
 * reasonable / what could make this wrong / what to verify with a
 * CPA-fiduciary. Governance stamps record which rule version and constants
 * produced it, and when it goes stale.
 */

// ─── Item 9: client-facing explanation ────────────────────────────────────────

export interface Explanation {
  whyNow: string
  whatCouldGoWrong: string
  dataUsed: string[]
  missingData: string[]
  whatToVerify: string
  professionalReviewNeeded: boolean
}

export function buildExplanation(e: Explanation): Explanation {
  return e   // identity with type enforcement — builders compose it below
}

// ─── Item 8: model governance stamp + staleness ───────────────────────────────

/** Bump when the next-dollar / checkup rule logic changes materially. */
export const NEXT_DOLLAR_RULE_VERSION = 'next-dollar/2'
export const WEALTH_CHECKUP_RULE_VERSION = 'wealth-checkup/2'
export const TAX_CALENDAR_RULE_VERSION = 'tax-calendar/1'

export interface GovernanceStamp {
  ruleVersion: string
  constantsYear: number | null
  yieldsFetchedAt: string | null
  profileUpdatedAt: string | null
  generatedAt: string
}

export interface StalenessVerdict {
  stale: boolean
  reasons: string[]
  /** Short UI copy, e.g. "Refresh needed — rates need verification". */
  uiCopy: string | null
}

const YIELD_MAX_AGE_MS = 7 * 86_400_000
const RECOMMENDATION_MAX_AGE_MS = 30 * 86_400_000

export function buildGovernanceStamp(args: {
  ruleVersion: string
  constantsYear?: number | null
  yieldsFetchedAt?: string | null
  profileUpdatedAt?: string | null
  now?: Date
}): GovernanceStamp {
  return {
    ruleVersion: args.ruleVersion,
    constantsYear: args.constantsYear ?? null,
    yieldsFetchedAt: args.yieldsFetchedAt ?? null,
    profileUpdatedAt: args.profileUpdatedAt ?? null,
    generatedAt: (args.now ?? new Date()).toISOString(),
  }
}

export function evaluateStaleness(
  stamp: GovernanceStamp,
  args: { currentProfileUpdatedAt?: string | null; now?: Date } = {}
): StalenessVerdict {
  const now = (args.now ?? new Date()).getTime()
  const reasons: string[] = []

  if (now - new Date(stamp.generatedAt).getTime() > RECOMMENDATION_MAX_AGE_MS) {
    reasons.push('Refresh needed — generated more than 30 days ago')
  }
  if (stamp.yieldsFetchedAt != null &&
      now - new Date(stamp.yieldsFetchedAt).getTime() > YIELD_MAX_AGE_MS) {
    reasons.push('Rates need verification — yield snapshot is older than a week')
  }
  if (stamp.constantsYear != null && stamp.constantsYear < new Date(now).getUTCFullYear()) {
    reasons.push(`Tax constants need review — generated against ${stamp.constantsYear} limits`)
  }
  if (args.currentProfileUpdatedAt && stamp.profileUpdatedAt &&
      args.currentProfileUpdatedAt > stamp.profileUpdatedAt) {
    reasons.push('Profile changed since generated — recommendation may no longer apply')
  }

  return {
    stale: reasons.length > 0,
    reasons,
    uiCopy: reasons.length > 0 ? reasons[0] : null,
  }
}

// ─── Item 3: suitability file ─────────────────────────────────────────────────

export interface SuitabilityFile {
  recommendationType: string
  recommendationId: string
  factsUsed: Record<string, unknown>
  missingFacts: string[]
  alternativesConsidered: string[]
  rejectedAlternatives: Array<{ alternative: string; reason: string }>
  riskProfileSnapshot: Record<string, unknown>
  conflictsDisclosed: string[]
  /** The five-part fiduciary narrative, assembled below. */
  explanation: string
  professionalReviewRequired: boolean
  ruleVersion: string
  constantsYear: number | null
  dataFreshness: Record<string, string | null>
}

export function buildSuitabilityFile(args: {
  recommendationType: string
  recommendationId: string
  whatWeKnow: Record<string, unknown>
  whatWeDoNotKnow: string[]
  whyReasonable: string
  whatCouldMakeThisWrong: string
  whatToVerify: string
  alternativesConsidered: string[]
  rejectedAlternatives: Array<{ alternative: string; reason: string }>
  riskProfileSnapshot?: Record<string, unknown>
  conflictsDisclosed?: string[]
  professionalReviewRequired?: boolean
  stamp: GovernanceStamp
}): SuitabilityFile {
  const knownLines = Object.entries(args.whatWeKnow)
    .map(([k, v]) => `  - ${k}: ${v == null ? 'unknown' : String(v)}`)
    .join('\n')
  const unknownLines = args.whatWeDoNotKnow.length
    ? args.whatWeDoNotKnow.map(f => `  - ${f}`).join('\n')
    : '  - nothing material'

  const explanation = [
    'WHAT WE KNOW:',
    knownLines || '  - (no profile facts recorded)',
    'WHAT WE DO NOT KNOW:',
    unknownLines,
    'WHY THIS IS REASONABLE:',
    `  ${args.whyReasonable}`,
    'WHAT COULD MAKE THIS WRONG:',
    `  ${args.whatCouldMakeThisWrong}`,
    'WHAT TO VERIFY WITH A CPA / FIDUCIARY ADVISOR:',
    `  ${args.whatToVerify}`,
  ].join('\n')

  return {
    recommendationType: args.recommendationType,
    recommendationId: args.recommendationId,
    factsUsed: args.whatWeKnow,
    missingFacts: args.whatWeDoNotKnow,
    alternativesConsidered: args.alternativesConsidered,
    rejectedAlternatives: args.rejectedAlternatives,
    riskProfileSnapshot: args.riskProfileSnapshot ?? {},
    conflictsDisclosed: args.conflictsDisclosed ?? [
      'This software validates trading strategies in paper mode; no compensation depends on any recommendation.',
    ],
    explanation,
    professionalReviewRequired: args.professionalReviewRequired ?? true,
    ruleVersion: args.stamp.ruleVersion,
    constantsYear: args.stamp.constantsYear,
    dataFreshness: {
      yields_fetched_at: args.stamp.yieldsFetchedAt,
      profile_updated_at: args.stamp.profileUpdatedAt,
      generated_at: args.stamp.generatedAt,
    },
  }
}
