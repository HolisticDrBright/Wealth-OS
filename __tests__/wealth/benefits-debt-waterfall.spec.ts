/**
 * Item 2 — employer match + debt in the waterfall. The five mandated cases:
 * missing match → needs_data; available match → near top; high-interest debt
 * → before investing; low-interest → not urgent; no debt data → never
 * guesses. Plus the explicitly designed ≥25% APR emergency exception.
 */

import { describe, it, expect } from 'vitest'
import { rankNextDollar, EMERGENCY_DEBT_APR_PCT, type NextDollarInputs } from '@/lib/advisory/next-dollar'
import { summarizeDebts, matchCaptureStatus } from '@/lib/advisory/benefits-debt'

function inputs(over: Partial<NextDollarInputs> = {}): NextDollarInputs {
  return {
    emergencyFundUsd: 20_000, emergencyTargetUsd: 18_000,
    employerMatchAvailable: false,
    highInterestDebtAprPct: 3, highInterestDebtBalanceUsd: 0,
    hsaEligible: true, hsaRemainingUsd: 2_000,
    rothPath: 'direct', iraRemainingUsd: 7_500,
    employee401kRemainingUsd: 10_000,
    tbillYieldPct: 4.2, hysaYieldPct: 3.9,
    debtPayoffHurdleAprPct: 0.06,
    speculativeSleeveCapFraction: 0.05,
    yieldsFetchedAt: new Date().toISOString(),
    ...over,
  }
}

describe('waterfall — the five mandated cases', () => {
  it('missing employer match → needs_data, never assumed', () => {
    const plan = rankNextDollar(inputs({ employerMatchAvailable: null }))
    const match = plan.steps.find(s => s.id === 'employer_match')!
    expect(match.status).toBe('needs_data')
    expect(match.missingInputs).toContain('employer match availability')
  })

  it('available match → recommended near the top (only emergency fund outranks it)', () => {
    const plan = rankNextDollar(inputs({ employerMatchAvailable: true }))
    expect(plan.bestNext?.id).toBe('employer_match')
    const match = plan.steps.find(s => s.id === 'employer_match')!
    expect(match.rank).toBe(2)
  })

  it('high-interest debt → recommended before every investing step', () => {
    const plan = rankNextDollar(inputs({ highInterestDebtAprPct: 19, highInterestDebtBalanceUsd: 4_000 }))
    const debt = plan.steps.find(s => s.id === 'high_interest_debt')!
    const hsa = plan.steps.find(s => s.id === 'hsa')!
    const roth = plan.steps.find(s => s.id === 'roth_ira')!
    expect(debt.status).toBe('recommended')
    expect(debt.rank).toBeLessThan(hsa.rank)
    expect(debt.rank).toBeLessThan(roth.rank)
    expect(plan.bestNext?.id).toBe('high_interest_debt')
  })

  it('low-interest debt → satisfied, not urgent', () => {
    const plan = rankNextDollar(inputs({ highInterestDebtAprPct: 4.5, highInterestDebtBalanceUsd: 200_000 }))
    expect(plan.steps.find(s => s.id === 'high_interest_debt')?.status).toBe('satisfied')
  })

  it('no debt data → needs_data, never a guess', () => {
    const plan = rankNextDollar(inputs({ highInterestDebtAprPct: null, highInterestDebtBalanceUsd: null }))
    const debt = plan.steps.find(s => s.id === 'high_interest_debt')!
    expect(debt.status).toBe('needs_data')
    expect(debt.quality.confidence).toBe('low')
  })
})

describe('emergency-debt exception (explicitly designed)', () => {
  it(`debt ≥ ${EMERGENCY_DEBT_APR_PCT}% APR ranks BEFORE the employer match`, () => {
    const plan = rankNextDollar(inputs({
      employerMatchAvailable: true,
      highInterestDebtAprPct: 29.99, highInterestDebtBalanceUsd: 8_000,
    }))
    const debt = plan.steps.find(s => s.id === 'high_interest_debt')!
    const match = plan.steps.find(s => s.id === 'employer_match')!
    expect(debt.rank).toBeLessThan(match.rank)
    expect(plan.bestNext?.id).toBe('high_interest_debt')
    expect(debt.reason).toContain(`≥${EMERGENCY_DEBT_APR_PCT}%`)
  })

  it(`debt below ${EMERGENCY_DEBT_APR_PCT}% keeps the match first`, () => {
    const plan = rankNextDollar(inputs({
      employerMatchAvailable: true,
      highInterestDebtAprPct: 22, highInterestDebtBalanceUsd: 8_000,
    }))
    const debt = plan.steps.find(s => s.id === 'high_interest_debt')!
    const match = plan.steps.find(s => s.id === 'employer_match')!
    expect(match.rank).toBeLessThan(debt.rank)
    expect(plan.bestNext?.id).toBe('employer_match')
  })
})

describe('summarizeDebts + matchCaptureStatus', () => {
  const debt = (over: Record<string, unknown>) => ({
    id: 'd1', name: 'Card', debtType: 'credit_card', balanceUsd: 1_000,
    aprPct: 20, minimumPaymentUsd: 35, payoffPriority: null, ...over,
  })

  it('finds the highest-APR debt and counts missing APRs', () => {
    const s = summarizeDebts([
      debt({ id: '1', name: 'Card A', aprPct: 24, balanceUsd: 3_000 }),
      debt({ id: '2', name: 'Auto', debtType: 'auto_loan', aprPct: 6, balanceUsd: 15_000 }),
      debt({ id: '3', name: 'Medical', aprPct: null, minimumPaymentUsd: null }),
    ])
    expect(s.highestApr?.name).toBe('Card A')
    expect(s.missingAprCount).toBe(1)
    expect(s.totalBalanceUsd).toBe(19_000)
    expect(s.payoffOrder[0].name).toBe('Card A')   // APR-descending when no explicit priority
  })

  it('explicit payoff priority overrides APR order', () => {
    const s = summarizeDebts([
      debt({ id: '1', name: 'Card A', aprPct: 24, payoffPriority: 2 }),
      debt({ id: '2', name: 'Loan B', aprPct: 8, payoffPriority: 1 }),
    ])
    expect(s.payoffOrder.map(d => d.name)).toEqual(['Loan B', 'Card A'])
  })

  it('match capture status: unknown / unclaimed / captured / none', () => {
    const base = {
      matchFormula: null, matchPercent: null, matchCapPctOfPay: null,
      vestingNotes: null, updatedAt: null,
    }
    expect(matchCaptureStatus({ ...base, matchAvailable: null, onTrackForFullMatch: null })).toBe('unknown')
    expect(matchCaptureStatus({ ...base, matchAvailable: false, onTrackForFullMatch: null })).toBe('none')
    expect(matchCaptureStatus({ ...base, matchAvailable: true, onTrackForFullMatch: false })).toBe('unclaimed')
    expect(matchCaptureStatus({ ...base, matchAvailable: true, onTrackForFullMatch: true })).toBe('captured')
    expect(matchCaptureStatus({ ...base, matchAvailable: true, onTrackForFullMatch: null })).toBe('on_track_unknown')
  })
})
