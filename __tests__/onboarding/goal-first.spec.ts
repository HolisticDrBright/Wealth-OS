/**
 * Phase 2 — goal-first onboarding + navigation.
 *
 *  - saveOnboardingGoal validates input, creates the household on first use,
 *    and writes to the EXISTING household_goals table (no new table).
 *  - the signup page handles the email-confirmation case and routes
 *    first-time users to onboarding, never straight to /dashboard.
 *  - /dashboard is gated on onboarding completion.
 *  - the landing page no longer links "View Demo" to the login-walled app.
 *  - the sidebar splits Portfolio/Planning and links the orphaned pages.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─── saveOnboardingGoal (mocked supabase) ────────────────────────────────────

interface Row { [k: string]: unknown }
const state: {
  user: { id: string } | null
  households: Row[]
  goalInserts: Row[]
  householdInsertFails: boolean
} = { user: { id: 'u1' }, households: [], goalInserts: [], householdInsertFails: false }

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      if (table === 'households') {
        return {
          select: () => ({
            eq: () => ({ limit: async () => ({ data: state.households }) }),
          }),
          insert: (row: Row) => ({
            select: () => ({
              single: async () => state.householdInsertFails
                ? { data: null, error: { message: 'insert failed' } }
                : { data: { id: 'hh-new', ...row }, error: null },
            }),
          }),
        }
      }
      if (table === 'household_goals') {
        return {
          insert: async (row: Row) => { state.goalInserts.push(row); return { error: null } },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

import { saveOnboardingGoal } from '@/lib/actions/onboarding'

describe('saveOnboardingGoal', () => {
  beforeEach(() => {
    state.user = { id: 'u1' }
    state.households = []
    state.goalInserts = []
    state.householdInsertFails = false
  })

  it('creates the household on first use and inserts the goal with contribution', async () => {
    const res = await saveOnboardingGoal({
      name: 'Home down payment', goalType: 'home',
      targetAmountUsd: 80_000, targetDate: '2029-06-01', monthlyContributionUsd: 500,
    })
    expect(res.ok).toBe(true)
    expect(state.goalInserts).toHaveLength(1)
    const g = state.goalInserts[0]
    expect(g.household_id).toBe('hh-new')
    expect(g.name).toBe('Home down payment')
    expect(g.goal_type).toBe('home')
    expect(g.target_amount_usd).toBe(80_000)
    expect(g.monthly_contribution_usd).toBe(500)
    expect(g.status).toBe('active')
  })

  it('reuses an existing household', async () => {
    state.households = [{ id: 'hh-existing' }]
    const res = await saveOnboardingGoal({
      name: 'Retirement', goalType: 'retirement',
      targetAmountUsd: 1_000_000, targetDate: null, monthlyContributionUsd: 0,
    })
    expect(res.ok).toBe(true)
    expect(state.goalInserts[0].household_id).toBe('hh-existing')
  })

  it.each([
    [{ name: '', targetAmountUsd: 1000, monthlyContributionUsd: 0 }, 'name'],
    [{ name: 'x', targetAmountUsd: 0, monthlyContributionUsd: 0 }, 'amount'],
    [{ name: 'x', targetAmountUsd: -5, monthlyContributionUsd: 0 }, 'amount'],
    [{ name: 'x', targetAmountUsd: 1000, monthlyContributionUsd: -1 }, 'contribution'],
  ])('rejects invalid input %#', async (partial) => {
    const res = await saveOnboardingGoal({
      goalType: 'general', targetDate: null,
      ...partial,
    } as Parameters<typeof saveOnboardingGoal>[0])
    expect(res.ok).toBe(false)
    expect(state.goalInserts).toHaveLength(0)
  })

  it('fails without a user', async () => {
    state.user = null
    const res = await saveOnboardingGoal({
      name: 'x', goalType: 'general', targetAmountUsd: 100, targetDate: null, monthlyContributionUsd: 0,
    })
    expect(res.ok).toBe(false)
  })
})

// ─── Source contracts ────────────────────────────────────────────────────────

const read = (p: string) => readFileSync(join(process.cwd(), ...p.split('/')), 'utf8')

describe('signup flow', () => {
  it('handles email confirmation and routes new sessions to onboarding, not /dashboard', () => {
    const src = read('app/signup/page.tsx')
    expect(src).toContain('!data.session')
    expect(src).toContain('Check your email')
    expect(src).toContain("router.push('/onboarding/risk-profile')")
    expect(src).not.toContain("router.push('/dashboard')")
    expect(src).not.toMatch(/setTimeout\([^)]*dashboard/)
  })
})

describe('/dashboard onboarding gate', () => {
  it('redirects un-onboarded users to the wizard', () => {
    const src = read('app/(app)/dashboard/page.tsx')
    expect(src).toContain('isOnboarded')
    expect(src).toContain("redirect('/onboarding/risk-profile')")
  })

  it('the wizard saves the goal BEFORE marking the profile onboarded', () => {
    const src = read('app/onboarding/risk-profile/page.tsx')
    const goalIdx = src.indexOf('saveOnboardingGoal(')
    const profileIdx = src.indexOf('saveOnboardedProfile(recommended')
    expect(goalIdx).toBeGreaterThan(-1)
    expect(profileIdx).toBeGreaterThan(goalIdx)
    // A failed goal save must stop the flow (no onboarded_at written).
    expect(src).toMatch(/if \(!goal\.ok\)[\s\S]{0,120}return/)
  })
})

describe('landing page', () => {
  it('no longer offers a "View Demo" link into the login-walled dashboard', () => {
    const src = read('app/page.tsx')
    expect(src).not.toContain('View Demo')
  })
})

describe('sidebar navigation', () => {
  const src = read('components/layout/sidebar.tsx')

  it('splits Portfolio and Planning into separate groups', () => {
    expect(src).toMatch(/label: 'Portfolio'/)
    expect(src).toMatch(/label: 'Planning'/)
    // Planning owns budget/retirement/tax/household per the brief.
    const planning = src.slice(src.indexOf("label: 'Planning'"), src.indexOf("label: 'Opportunities'"))
    for (const href of ['/budget', '/retirement', '/tax', '/household']) {
      expect(planning).toContain(`'${href}'`)
    }
  })

  it('links the orphaned /paper-trading and /settings/ai-features pages', () => {
    expect(src).toMatch(/['"]\/paper-trading['"]/)
    expect(src).toMatch(/['"]\/settings\/ai-features['"]/)
  })

  it('collapses to a drawer below md', () => {
    expect(src).toContain('hidden h-screen w-64 flex-col border-r border-white/10 bg-[#0a0b0f] md:flex')
    expect(src).toContain('MobileNav')
    const layout = read('app/(app)/layout.tsx')
    expect(layout).toMatch(/<MobileNav[ />]/)
  })
})
