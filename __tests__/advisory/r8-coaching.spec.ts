/**
 * P2 — Owner Dependency Audit (r8) + coaching/quantified separation.
 *  - trigger / not-applicable
 *  - coaching cards carry grade + never contribute to benefit totals
 *  - coaching cards rank below every quantified card
 *  - coaching outputs are excluded from Monte Carlo inputs (grep + unit)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { r8BusinessSystemization } from '@/lib/advisory/rules/r8-business-systemization'
import { evaluateAllRules, gradeOf } from '@/lib/advisory/engine'
import type { FinancialProfile, TaxConstants, KbParameters } from '@/lib/advisory/types'

const CONSTANTS: TaxConstants = { ira_limit: 7500 }
const PARAMS: KbParameters = {
  emergency_months_w2: 3, emergency_months_family: 6, emergency_months_self_employed: 9,
}

function profile(over: Partial<FinancialProfile> = {}): FinancialProfile {
  return {
    filing_status: 'single', age_self: 40, age_spouse: null, state: 'TX',
    business_entity: 'llc', net_business_profit_usd: 120_000,
    w2_wages_usd: null, prior_year_wages_usd: null, magi_estimate_usd: 120_000,
    health_plan_type: 'ppo', monthly_essential_expenses_usd: 5_000, liquid_cash_usd: 60_000,
    income_stability: 'self_employed', has_employees: false, spouse_only_employee: null,
    traditional_ira_balance_usd: null, ytd_401k_employee_usd: null, ytd_ira_contribution_usd: null,
    ytd_hsa_contribution_usd: null, has_separate_business_bank: null, home_office_sqft: null,
    business_miles_annual: null, business_context: null,
    ...over,
  }
}

describe('r8 trigger', () => {
  it('fires for a profitable business — coaching grade, null benefit', () => {
    const v = r8BusinessSystemization.evaluate(profile(), CONSTANTS, PARAMS)
    expect(v.kind).toBe('recommendation')
    if (v.kind !== 'recommendation') return
    expect(v.grade).toBe('coaching')
    expect(v.estimatedAnnualBenefitUsd).toBeNull()
  })

  it('not applicable with no business or no profit', () => {
    expect(r8BusinessSystemization.evaluate(profile({ business_entity: 'none' }), CONSTANTS, PARAMS).kind)
      .toBe('not_applicable')
    expect(r8BusinessSystemization.evaluate(profile({ net_business_profit_usd: 0 }), CONSTANTS, PARAMS).kind)
      .toBe('not_applicable')
  })

  it('asks the CONTEXT questions when business_context is empty', () => {
    const v = r8BusinessSystemization.evaluate(profile({ business_context: null }), CONSTANTS, PARAMS)
    if (v.kind !== 'recommendation') throw new Error('expected recommendation')
    expect(v.actionSteps.join(' ')).toContain('weekly_owner_tasks')
    expect(v.actionSteps.join(' ')).toContain('two_week_absence_breakage')
  })

  it('produces the audit + Operations Architect follow-up when context + selected task exist', () => {
    const v = r8BusinessSystemization.evaluate(profile({
      business_context: {
        weekly_owner_tasks: ['invoicing', 'sales calls'],
        two_week_absence_breakage: 'invoices stop going out',
        selected_task: 'invoicing',
      },
    }), CONSTANTS, PARAMS)
    if (v.kind !== 'recommendation') throw new Error('expected recommendation')
    expect(v.title).toContain('invoicing')
    const steps = v.actionSteps.join(' ')
    expect(steps).toContain('OPERATIONS ARCHITECT')
    expect(steps).toContain('minimum viable process')
    expect(steps).toContain('break point')
  })
})

describe('coaching/quantified separation in the engine', () => {
  it('coaching cards never contribute to the benefit total', () => {
    const evalr = evaluateAllRules(profile(), CONSTANTS, PARAMS)
    const coaching = evalr.recommendations.filter(r => gradeOf(r) === 'coaching')
    expect(coaching.length).toBeGreaterThan(0)
    // Total equals the sum of QUANTIFIED benefits only.
    const quantifiedSum = evalr.recommendations
      .filter(r => gradeOf(r) === 'quantified')
      .reduce((s, r) => s + (r.estimatedAnnualBenefitUsd ?? 0), 0)
    expect(evalr.totalEstimatedAnnualBenefitUsd).toBe(quantifiedSum)
  })

  it('every coaching card ranks below every quantified card', () => {
    const evalr = evaluateAllRules(profile(), CONSTANTS, PARAMS)
    const firstCoachingIdx = evalr.recommendations.findIndex(r => gradeOf(r) === 'coaching')
    const lastQuantIdx = evalr.recommendations.map(r => gradeOf(r))
      .lastIndexOf('quantified')
    if (firstCoachingIdx >= 0 && lastQuantIdx >= 0) {
      expect(firstCoachingIdx).toBeGreaterThan(lastQuantIdx)
    }
  })
})

describe('Monte Carlo never consumes coaching outputs', () => {
  it('planning.ts explicitly filters coaching grade before the simulation', () => {
    const src = readFileSync(join(process.cwd(), 'lib', 'actions', 'planning.ts'), 'utf8')
    expect(src).toMatch(/grade.*!==.*['"]coaching['"]/)
  })

  it('r8 output has null benefit so it cannot enter the benefit-driven MC deltas', () => {
    const v = r8BusinessSystemization.evaluate(profile(), CONSTANTS, PARAMS)
    if (v.kind !== 'recommendation') throw new Error('expected recommendation')
    // planning.ts selects deltas from recs with benefit > 0 — null is excluded.
    expect((v.estimatedAnnualBenefitUsd ?? 0) > 0).toBe(false)
  })
})
