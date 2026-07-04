/**
 * Items 3 + 8 + 9 — suitability files (missing facts + alternatives are
 * ALWAYS recorded), governance stamps, staleness copy, and explanations.
 */

import { describe, it, expect } from 'vitest'
import {
  buildSuitabilityFile,
  buildGovernanceStamp,
  evaluateStaleness,
  buildExplanation,
  NEXT_DOLLAR_RULE_VERSION,
} from '@/lib/advisory/suitability'

describe('buildSuitabilityFile (item 3)', () => {
  const stamp = buildGovernanceStamp({
    ruleVersion: NEXT_DOLLAR_RULE_VERSION,
    constantsYear: 2026,
    yieldsFetchedAt: new Date().toISOString(),
  })

  const file = buildSuitabilityFile({
    recommendationType: 'next_dollar',
    recommendationId: 'employer_match',
    whatWeKnow: { 'liquid cash': 5000, 'match status': 'unclaimed' },
    whatWeDoNotKnow: ['debt balances and APRs', 'vesting schedule'],
    whyReasonable: 'An unclaimed employer match is a guaranteed return no market investment beats.',
    whatCouldMakeThisWrong: 'Unrecorded high-interest debt or imminent cash needs would reorder the waterfall.',
    whatToVerify: 'Plan match documents and vesting schedule with HR; overall fit with a fiduciary advisor.',
    alternativesConsidered: ['Emergency fund', 'HSA', 'Roth IRA', 'Taxable investing'],
    rejectedAlternatives: [
      { alternative: 'Roth IRA', reason: 'ranked below the match: no guaranteed return' },
    ],
    stamp,
  })

  it('records missing facts and alternatives — never an empty audit trail', () => {
    expect(file.missingFacts).toEqual(['debt balances and APRs', 'vesting schedule'])
    expect(file.alternativesConsidered).toContain('Roth IRA')
    expect(file.rejectedAlternatives[0].alternative).toBe('Roth IRA')
    expect(file.professionalReviewRequired).toBe(true)
    expect(file.conflictsDisclosed.length).toBeGreaterThan(0)
  })

  it('the explanation follows the five-part fiduciary pattern', () => {
    expect(file.explanation).toContain('WHAT WE KNOW:')
    expect(file.explanation).toContain('WHAT WE DO NOT KNOW:')
    expect(file.explanation).toContain('WHY THIS IS REASONABLE:')
    expect(file.explanation).toContain('WHAT COULD MAKE THIS WRONG:')
    expect(file.explanation).toContain('WHAT TO VERIFY WITH A CPA / FIDUCIARY ADVISOR:')
    expect(file.explanation).toContain('vesting schedule')
  })

  it('carries the governance stamp (rule version, constants year, freshness)', () => {
    expect(file.ruleVersion).toBe(NEXT_DOLLAR_RULE_VERSION)
    expect(file.constantsYear).toBe(2026)
    expect(file.dataFreshness.generated_at).toBe(stamp.generatedAt)
  })
})

describe('governance staleness (item 8)', () => {
  it('fresh stamp → not stale', () => {
    const stamp = buildGovernanceStamp({
      ruleVersion: 'x/1', constantsYear: new Date().getUTCFullYear(),
      yieldsFetchedAt: new Date().toISOString(),
    })
    const v = evaluateStaleness(stamp)
    expect(v.stale).toBe(false)
    expect(v.uiCopy).toBeNull()
  })

  it('old yields → "Rates need verification"', () => {
    const stamp = buildGovernanceStamp({
      ruleVersion: 'x/1',
      yieldsFetchedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    })
    const v = evaluateStaleness(stamp)
    expect(v.stale).toBe(true)
    expect(v.reasons.some(r => r.includes('Rates need verification'))).toBe(true)
  })

  it('prior-year constants → "Tax constants need review"', () => {
    const stamp = buildGovernanceStamp({
      ruleVersion: 'x/1', constantsYear: new Date().getUTCFullYear() - 1,
    })
    const v = evaluateStaleness(stamp)
    expect(v.reasons.some(r => r.includes('Tax constants need review'))).toBe(true)
  })

  it('old recommendation → "Refresh needed"; profile change flagged', () => {
    const old = buildGovernanceStamp({
      ruleVersion: 'x/1',
      profileUpdatedAt: '2026-01-01T00:00:00Z',
      now: new Date(Date.now() - 40 * 86_400_000),
    })
    const v = evaluateStaleness(old, { currentProfileUpdatedAt: '2026-06-01T00:00:00Z' })
    expect(v.reasons.some(r => r.includes('Refresh needed'))).toBe(true)
    expect(v.reasons.some(r => r.includes('Profile changed since generated'))).toBe(true)
  })
})

describe('explanations (item 9)', () => {
  it('the structured shape carries all six sections', () => {
    const e = buildExplanation({
      whyNow: 'why', whatCouldGoWrong: 'wrong', dataUsed: ['a'],
      missingData: ['b'], whatToVerify: 'verify', professionalReviewNeeded: true,
    })
    expect(e.whyNow).toBe('why')
    expect(e.missingData).toEqual(['b'])
    expect(e.professionalReviewNeeded).toBe(true)
  })
})
