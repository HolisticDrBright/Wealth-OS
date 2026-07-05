/**
 * Advisory rules engine — table-driven tests per rule: trigger,
 * not-applicable, and contraindicated cases. Constants mirror the 2026
 * migration seed (rules never hardcode them).
 */

import { describe, it, expect } from 'vitest'
import type { FinancialProfile, TaxConstants, KbParameters } from '@/lib/advisory/types'
import { evaluateAllRules } from '@/lib/advisory/engine'
import { r1ScorpElection, computeSeTax, computeFicaOnSalary } from '@/lib/advisory/rules/r1-scorp-election'
import { r2RothBackdoor } from '@/lib/advisory/rules/r2-roth-backdoor'
import { r3EmergencyFund } from '@/lib/advisory/rules/r3-emergency-fund'
import { r4Hsa } from '@/lib/advisory/rules/r4-hsa'
import { r5BusinessDeductions } from '@/lib/advisory/rules/r5-business-deductions'
import { r6Solo401k } from '@/lib/advisory/rules/r6-solo-401k'
import { r7BusinessBanking } from '@/lib/advisory/rules/r7-business-banking'

// Mirrors the 2026 seed in 20260703c_advisory_module.sql
const C: TaxConstants = {
  se_tax_rate: 0.153, se_ss_rate: 0.124, se_medicare_rate: 0.029,
  se_earnings_factor: 0.9235, ss_wage_base: 184_500,
  ira_limit: 7_500, ira_catchup_50: 1_100,
  roth_phaseout_single_start: 153_000, roth_phaseout_single_end: 168_000,
  roth_phaseout_mfj_start: 242_000, roth_phaseout_mfj_end: 252_000,
  hsa_limit_single: 4_400, hsa_limit_family: 8_750, hsa_catchup_55: 1_000,
  solo401k_employee: 24_500, solo401k_total: 72_000,
  '401k_catchup_50': 8_000, '401k_catchup_60_63': 11_250,
  roth_catchup_mandate_wage_threshold: 150_000,
  mileage_rate_business: 0.725,
  home_office_safe_harbor_per_sqft: 5, home_office_safe_harbor_max_sqft: 300,
  scorp_employer_match_factor: 0.25,
  ltcg_top_rate_with_niit: 0.238, stcg_top_rate_with_niit: 0.408,
  ca_scorp_franchise_rate: 0.015, ca_franchise_min: 800,
  qbi_deduction_rate: 0.20,
}

const P: KbParameters = {
  emergency_months_w2: 3, emergency_months_family: 6, emergency_months_self_employed: 9,
  scorp_min_profit: 80_000, scorp_min_savings: 3_000,
  scorp_payroll_cost_low: 500, scorp_payroll_cost_high: 1_200,
  scorp_contraindicated_profit: 50_000, scorp_min_reasonable_salary: 40_000,
  scorp_reasonable_salary_factor: 0.4, scorp_min_distribution: 20_000,
  assumed_marginal_rate: 0.22, roth_annual_drag_saved_rate: 0.005,
  hdhp_consideration_confidence: 0.5,
}

function profile(overrides: Partial<FinancialProfile> = {}): FinancialProfile {
  return {
    filing_status: 'single', age_self: 40, age_spouse: null, state: 'TX',
    business_entity: 'llc', net_business_profit_usd: 150_000,
    w2_wages_usd: 0, prior_year_wages_usd: 0, magi_estimate_usd: 140_000,
    health_plan_type: 'hdhp', monthly_essential_expenses_usd: 5_000,
    liquid_cash_usd: 60_000, income_stability: 'self_employed',
    has_employees: false, spouse_only_employee: false,
    traditional_ira_balance_usd: 0, ytd_401k_employee_usd: 0,
    ytd_ira_contribution_usd: 0, ytd_hsa_contribution_usd: 0,
    has_separate_business_bank: true, home_office_sqft: 200,
    business_miles_annual: 2_000,
    ...overrides,
  }
}

// ─── R1 S-corp — the corrected math (acceptance: within $100 at $150k) ────────

describe('R1 S-corp election', () => {
  it('reproduces the corrected SE-tax math at $150k profit within $100', () => {
    // Brief: $150k × 0.9235 × 15.3% ≈ $21,194 (NOT the source list’s $22,950)
    expect(computeSeTax(150_000, C)).toBeCloseTo(21_194, -2)
    // $60k salary → FICA ≈ $9,180
    expect(computeFicaOnSalary(60_000, C)).toBeCloseTo(9_180, -2)
  })

  it('caps the SS portion at the wage base for large profits', () => {
    // $300k: SS on min(277,050, 184,500) + Medicare on full 277,050
    const expected = 184_500 * 0.124 + 300_000 * 0.9235 * 0.029
    expect(computeSeTax(300_000, C)).toBeCloseTo(expected, 2)
  })

  it('triggers at $150k LLC profit with honest net savings ($8k–$11.5k band)', () => {
    const v = r1ScorpElection.evaluate(profile(), C, P)
    expect(v.kind).toBe('recommendation')
    if (v.kind !== 'recommendation') return
    expect(v.estimatedAnnualBenefitUsd).toBeGreaterThanOrEqual(8_000)
    expect(v.estimatedAnnualBenefitUsd).toBeLessThanOrEqual(11_500)
    // The math is SHOWN — SE tax, FICA, payroll cost, QBI impact all present
    const labels = v.math.map(m => m.label).join(' | ')
    expect(labels).toContain('SE tax')
    expect(labels).toContain('QBI')
    expect(v.deadline).toMatch(/-03-15$/)
  })

  it('CA profile subtracts franchise tax (1.5%, $800 min) from savings', () => {
    const tx = r1ScorpElection.evaluate(profile({ state: 'TX' }), C, P)
    const ca = r1ScorpElection.evaluate(profile({ state: 'CA' }), C, P)
    if (tx.kind !== 'recommendation' || ca.kind !== 'recommendation') throw new Error('expected recommendations')
    expect(ca.estimatedAnnualBenefitUsd!).toBeCloseTo(
      tx.estimatedAnnualBenefitUsd! - Math.max(800, 150_000 * 0.015), -2
    )
  })

  it('not applicable below the $80k profit threshold; contraindicated below $50k', () => {
    expect(r1ScorpElection.evaluate(profile({ net_business_profit_usd: 70_000 }), C, P).kind).toBe('not_applicable')
    expect(r1ScorpElection.evaluate(profile({ net_business_profit_usd: 45_000 }), C, P).kind).toBe('contraindicated')
  })

  it('not applicable when already an S-corp or fields are missing', () => {
    expect(r1ScorpElection.evaluate(profile({ business_entity: 'scorp' }), C, P).kind).toBe('not_applicable')
    const v = r1ScorpElection.evaluate(profile({ net_business_profit_usd: null }), C, P)
    expect(v.kind).toBe('not_applicable')
    if (v.kind === 'not_applicable') expect(v.missingFields).toContain('net_business_profit_usd')
  })
})

// ─── R2 Roth / backdoor — pro-rata gating (acceptance) ────────────────────────

describe('R2 Roth / backdoor', () => {
  it('below phase-out → direct Roth with correct 2026 room', () => {
    const v = r2RothBackdoor.evaluate(profile({ magi_estimate_usd: 100_000, liquid_cash_usd: 80_000 }), C, P)
    expect(v.kind).toBe('recommendation')
    if (v.kind !== 'recommendation') return
    expect(v.title).toContain('$7,500')
  })

  it('age 50+ adds the $1,100 catch-up (couple math: $8,600 per person)', () => {
    const v = r2RothBackdoor.evaluate(profile({ age_self: 52, magi_estimate_usd: 100_000, liquid_cash_usd: 80_000 }), C, P)
    if (v.kind !== 'recommendation') throw new Error('expected recommendation')
    expect(v.title).toContain('$8,600')
  })

  it('above phase-out WITH pre-tax IRA → backdoor gated on the pro-rata trap', () => {
    const v = r2RothBackdoor.evaluate(
      profile({ magi_estimate_usd: 200_000, traditional_ira_balance_usd: 50_000, liquid_cash_usd: 80_000 }), C, P)
    if (v.kind !== 'recommendation') throw new Error('expected recommendation')
    expect(v.title.toLowerCase()).toContain('pro-rata')
    expect(v.actionSteps[0].toLowerCase()).toContain('solo 401(k)')
  })

  it('above phase-out with NO pre-tax IRA → clean backdoor', () => {
    const v = r2RothBackdoor.evaluate(
      profile({ magi_estimate_usd: 200_000, traditional_ira_balance_usd: 0, liquid_cash_usd: 80_000 }), C, P)
    if (v.kind !== 'recommendation') throw new Error('expected recommendation')
    expect(v.title.toLowerCase()).toContain('backdoor')
    expect(v.title.toLowerCase()).not.toContain('trap')
    expect(v.actionSteps.join(' ').toLowerCase()).not.toContain('roll pre-tax')
  })

  it('emergency fund unfunded → not applicable (waterfall order)', () => {
    // self-employed → 9 × $5k = $45k target; only $30k liquid
    const v = r2RothBackdoor.evaluate(profile({ liquid_cash_usd: 30_000 }), C, P)
    expect(v.kind).toBe('not_applicable')
    if (v.kind === 'not_applicable') expect(v.reason).toContain('Emergency fund first')
  })

  it('room already filled → not applicable', () => {
    const v = r2RothBackdoor.evaluate(profile({ ytd_ira_contribution_usd: 7_500, liquid_cash_usd: 80_000 }), C, P)
    expect(v.kind).toBe('not_applicable')
  })
})

// ─── R3 emergency fund ───────────────────────────────────────────────────────

describe('R3 emergency fund', () => {
  it('self-employed target is 9 months; gap computed from profile', () => {
    const v = r3EmergencyFund.evaluate(profile({ liquid_cash_usd: 20_000 }), C, P)
    if (v.kind !== 'recommendation') throw new Error('expected recommendation')
    expect(v.math[0].valueUsd).toBe(45_000)          // 9 × 5k
    expect(v.math[2].valueUsd).toBe(25_000)          // gap
    expect(v.estimatedAnnualBenefitUsd).toBeNull()   // yields are live, never hardcoded
  })

  it('stable W-2 target is 3 months; funded → not applicable', () => {
    const v = r3EmergencyFund.evaluate(
      profile({ income_stability: 'stable_w2', liquid_cash_usd: 16_000 }), C, P)
    expect(v.kind).toBe('not_applicable')
  })
})

// ─── R4 HSA ──────────────────────────────────────────────────────────────────

describe('R4 HSA', () => {
  it('HDHP single → $4,400 room; benefit = room × marginal rate', () => {
    const v = r4Hsa.evaluate(profile(), C, P)
    if (v.kind !== 'recommendation') throw new Error('expected recommendation')
    expect(v.title).toContain('$4,400')
    expect(v.estimatedAnnualBenefitUsd).toBe(Math.round(4_400 * 0.22))
  })

  it('MFJ 55+ → family limit + catch-up ($9,750)', () => {
    const v = r4Hsa.evaluate(profile({ filing_status: 'mfj', age_self: 56 }), C, P)
    if (v.kind !== 'recommendation') throw new Error('expected recommendation')
    expect(v.title).toContain('$9,750')
  })

  it('CA profile carries the state-nonconformity caveat', () => {
    const v = r4Hsa.evaluate(profile({ state: 'CA' }), C, P)
    if (v.kind !== 'recommendation') throw new Error('expected recommendation')
    expect(v.counterIndications.join(' ')).toContain('CA')
  })

  it('non-HDHP → lower-confidence consideration card, no benefit claimed', () => {
    const v = r4Hsa.evaluate(profile({ health_plan_type: 'ppo' }), C, P)
    if (v.kind !== 'recommendation') throw new Error('expected recommendation')
    expect(v.title.toLowerCase()).toContain('consider')
    expect(v.estimatedAnnualBenefitUsd).toBeNull()
  })
})

// ─── R5 deductions ───────────────────────────────────────────────────────────

describe('R5 business deductions', () => {
  it('computes safe harbor and 2026 mileage from profile fields', () => {
    const v = r5BusinessDeductions.evaluate(profile(), C, P)
    if (v.kind !== 'recommendation') throw new Error('expected recommendation')
    const homeOffice = v.math.find(m => m.label.includes('Home office'))
    const mileage = v.math.find(m => m.label.includes('mileage'))
    expect(homeOffice?.valueUsd).toBe(200 * 5)
    expect(mileage?.valueUsd).toBeCloseTo(2_000 * 0.725, 6)   // $0.725, not the stale $0.67
  })

  it('sqft capped at 300', () => {
    const v = r5BusinessDeductions.evaluate(profile({ home_office_sqft: 500 }), C, P)
    if (v.kind !== 'recommendation') throw new Error('expected recommendation')
    expect(v.math.find(m => m.label.includes('Home office'))?.valueUsd).toBe(300 * 5)
  })

  it('no business income → not applicable', () => {
    expect(r5BusinessDeductions.evaluate(profile({ net_business_profit_usd: 0 }), C, P).kind).toBe('not_applicable')
  })
})

// ─── R6 Solo 401(k) ──────────────────────────────────────────────────────────

describe('R6 Solo 401(k)', () => {
  it('sole prop / LLC: employee deferral + ~20% employer, capped at $72k', () => {
    const v = r6Solo401k.evaluate(profile(), C, P)
    if (v.kind !== 'recommendation') throw new Error('expected recommendation')
    expect(v.math[0].valueUsd).toBe(24_500)
    const total = v.math.find(m => m.label.includes('Total room'))
    expect(total!.valueUsd).toBeLessThanOrEqual(72_000)
  })

  it('S-corp employer contribution keys off W-2 salary only ($60k → $15k)', () => {
    const v = r6Solo401k.evaluate(
      profile({ business_entity: 'scorp', w2_wages_usd: 60_000 }), C, P)
    if (v.kind !== 'recommendation') throw new Error('expected recommendation')
    const employer = v.math.find(m => m.label.includes('Employer contribution'))
    expect(employer!.valueUsd).toBe(15_000)
  })

  it('ages 60–63 get the enhanced $11,250 catch-up', () => {
    const v = r6Solo401k.evaluate(profile({ age_self: 61 }), C, P)
    if (v.kind !== 'recommendation') throw new Error('expected recommendation')
    expect(v.math[0].valueUsd).toBe(24_500 + 11_250)
  })

  it('prior-year wages > $150k + catch-up age → Roth catch-up mandate surfaces', () => {
    const v = r6Solo401k.evaluate(
      profile({ age_self: 55, prior_year_wages_usd: 200_000 }), C, P)
    if (v.kind !== 'recommendation') throw new Error('expected recommendation')
    expect(v.counterIndications.join(' ')).toContain('MUST be Roth')
  })

  it('employees beyond spouse → contraindicated', () => {
    const v = r6Solo401k.evaluate(profile({ has_employees: true, spouse_only_employee: false }), C, P)
    expect(v.kind).toBe('contraindicated')
  })
})

// ─── R7 banking hygiene ──────────────────────────────────────────────────────

describe('R7 business banking', () => {
  it('entity without separate banking → recommendation', () => {
    const v = r7BusinessBanking.evaluate(profile({ has_separate_business_bank: false }), C, P)
    expect(v.kind).toBe('recommendation')
  })
  it('already separated / no entity → not applicable', () => {
    expect(r7BusinessBanking.evaluate(profile(), C, P).kind).toBe('not_applicable')
    expect(r7BusinessBanking.evaluate(profile({ business_entity: 'none' }), C, P).kind).toBe('not_applicable')
  })
})

// ─── Engine ──────────────────────────────────────────────────────────────────

describe('evaluateAllRules', () => {
  it('ranks recommendations by estimated benefit and totals them', () => {
    const { recommendations, totalEstimatedAnnualBenefitUsd, verdicts } =
      evaluateAllRules(profile({ liquid_cash_usd: 80_000 }), C, P)
    expect(verdicts).toHaveLength(9)   // r1–r9 (r8/r9 = coaching cards)
    expect(recommendations.length).toBeGreaterThanOrEqual(3)
    // Sorted descending by benefit (nulls last)
    for (let i = 1; i < recommendations.length; i++) {
      const prev = recommendations[i - 1].estimatedAnnualBenefitUsd ?? -1
      const curr = recommendations[i].estimatedAnnualBenefitUsd ?? -1
      expect(prev).toBeGreaterThanOrEqual(curr)
    }
    expect(totalEstimatedAnnualBenefitUsd).toBeGreaterThan(0)
    // S-corp should rank first at this profile
    expect(recommendations[0].ruleId).toBe('r1_scorp_election')
  })
})
