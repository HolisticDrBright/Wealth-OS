/**
 * Item 9 — wealth checkup loader: honest items with data-quality labels,
 * needs_data for anything uncollected, no loophole language anywhere.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  profile: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      const rows = state.tables[table] ?? []
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'gte', 'order', 'limit', 'in']) chain[m] = () => chain
      chain.single = async () => ({ data: rows[0] ?? null, error: null })
      chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null })
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve)
      return chain
    },
  }),
}))

vi.mock('@/lib/actions/advisory', () => ({
  getFinancialProfile: async () => state.profile,
}))

vi.mock('@/lib/advisory/yields', () => ({
  fetchCurrentYields: async () => ({
    tbill3moPct: 4.2, savingsNationalAvgPct: 3.8, fetchedAt: new Date().toISOString(),
  }),
}))

import { getWealthCheckup } from '@/lib/actions/wealth-checkup'

const CONSTANTS = [
  { key: 'ira_limit', value: 7500, verified_at: new Date().toISOString() },
  { key: 'hsa_limit_single', value: 4400, verified_at: new Date().toISOString() },
  { key: 'hsa_limit_family', value: 8750, verified_at: new Date().toISOString() },
  { key: 'solo401k_employee', value: 24500, verified_at: new Date().toISOString() },
  { key: 'roth_phaseout_single_start', value: 153000, verified_at: new Date().toISOString() },
  { key: 'roth_phaseout_single_end', value: 168000, verified_at: new Date().toISOString() },
  { key: 'roth_phaseout_mfj_start', value: 242000, verified_at: new Date().toISOString() },
  { key: 'roth_phaseout_mfj_end', value: 252000, verified_at: new Date().toISOString() },
]
const PARAMS = [
  { key: 'emergency_months_w2', value: 3, verified_at: new Date().toISOString() },
  { key: 'emergency_months_family', value: 6, verified_at: new Date().toISOString() },
  { key: 'emergency_months_self_employed', value: 9, verified_at: new Date().toISOString() },
  { key: 'debt_payoff_hurdle_apr', value: 0.06, verified_at: new Date().toISOString() },
  { key: 'sleeve_cap_mass_market', value: 0.05, verified_at: new Date().toISOString() },
  { key: 'sleeve_cap_mass_affluent', value: 0.10, verified_at: new Date().toISOString() },
]

beforeEach(() => {
  state.tables = { tax_constants: CONSTANTS, kb_parameters: PARAMS }
  state.profile = null
})

describe('getWealthCheckup', () => {
  it('empty profile → needs_data items with missing-input lists, not guesses', async () => {
    const checkup = await getWealthCheckup()

    expect(checkup.error).toBeUndefined()
    const emergency = checkup.items.find(i => i.id === 'emergency_fund')
    expect(emergency?.status).toBe('needs_data')
    expect(emergency?.quality.missingInputs).toContain('monthly essential expenses')

    const debt = checkup.items.find(i => i.id === 'debt')
    expect(debt?.status).toBe('needs_data')

    expect(checkup.missingData.length).toBeGreaterThan(0)
    expect(checkup.missingData).toContain('debt balances and APRs')

    // Waterfall present with paper bankroll last.
    const ids = checkup.nextDollar.steps.map(s => s.id)
    expect(ids[ids.length - 1]).toBe('paper_bankroll')
  })

  it('funded profile → underfunded emergency fund flagged as action with math', async () => {
    state.profile = {
      liquid_cash_usd: 5_000,
      monthly_essential_expenses_usd: 4_000,
      income_stability: 'stable_w2',
      filing_status: 'single',
      magi_estimate_usd: 90_000,
      health_plan_type: 'hdhp',
      ytd_hsa_contribution_usd: 1_000,
      ytd_ira_contribution_usd: 0,
      ytd_401k_employee_usd: 5_000,
    }
    const checkup = await getWealthCheckup()

    const emergency = checkup.items.find(i => i.id === 'emergency_fund')
    expect(emergency?.status).toBe('action')
    expect(emergency?.summary).toContain('$7,000')   // 12k target − 5k

    // Direct Roth path flows into the waterfall.
    const roth = checkup.nextDollar.steps.find(s => s.id === 'roth_ira')
    expect(roth?.title).toContain('direct')
    // Best next dollar is the emergency fund.
    expect(checkup.nextDollar.bestNext?.id).toBe('emergency_fund')
  })

  it('every item carries a quality label; copy never says loophole', async () => {
    state.profile = { liquid_cash_usd: 50_000, monthly_essential_expenses_usd: 4_000, income_stability: 'stable_w2' }
    const checkup = await getWealthCheckup()

    for (const item of checkup.items) {
      expect(item.quality.informationalOnly).toBe(true)
      expect(item.quality.completenessPct).toBeGreaterThanOrEqual(0)
      expect(item.quality.completenessPct).toBeLessThanOrEqual(100)
    }
    expect(JSON.stringify(checkup).toLowerCase()).not.toContain('loophole')
    expect(checkup.disclaimer.length).toBeGreaterThan(20)
  })
})
