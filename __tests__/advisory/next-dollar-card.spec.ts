/**
 * Roadmap #1 — "best next dollar" on Home and the phone, plus the raise
 * prompt (#6).
 *  - ONE emergency definition: the waterfall uses the ladder's Tier 1 Safety,
 *  - the card asks the highest-ranked missing fact first and never jumps to
 *    "invest" while a higher step is unknown,
 *  - skips and missing tax limits move on honestly,
 *  - plain English, no jargon in Simple mode,
 *  - raise prompt math and its writes; nothing here trades.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { rankNextDollar } from '@/lib/advisory/next-dollar'
import { nextDollarInputsFrom, type NextDollarSources } from '@/lib/advisory/next-dollar-inputs'
import {
  buildNextDollarCard, raisePromptFor, QUESTIONS, ALL_FACTS, STEP_FACTS,
  type NextDollarFacts, type FactKey, type PlainContext,
} from '@/lib/advisory/next-dollar-card'
import { EMPTY_EMPLOYER_BENEFITS } from '@/lib/advisory/benefits-debt'
import { computeLadder } from '@/lib/allocation/ladder'
import {
  RAISE_MIN_INCREASE, RAISE_TAKE_HOME_FRACTION, RAISE_SAVE_SHARE, DEPOSIT_ROUND_USD,
} from '@/lib/config/product-defaults'

const read = (p: string) => readFileSync(join(process.cwd(), ...p.split('/')), 'utf8')
const NOW = new Date('2026-11-24T00:00:00Z')

const CONSTANTS = {
  ira_limit: 7_000, hsa_limit_single: 4_300, hsa_limit_family: 8_550, solo401k_employee: 23_500,
  roth_phaseout_single_start: 150_000, roth_phaseout_single_end: 165_000,
  roth_phaseout_mfj_start: 236_000, roth_phaseout_mfj_end: 246_000,
}

function ladderWith(cash: number, expenses: number | null) {
  return computeLadder({
    assets: [{ category: 'stock', current_value: 50_000 }, { category: 'cash', current_value: cash }],
    monthlyExpensesUsd: expenses, goals: [], profileKey: 'balanced', exploreCapFraction: null,
    tier1DesignatedUsd: 0, exploreInUseUsd: 0, now: NOW,
  })
}

function sources(over: Partial<NextDollarSources> = {}): NextDollarSources {
  return {
    profile: {}, benefits: EMPTY_EMPLOYER_BENEFITS, debts: [], noHighInterestDebtConfirmed: false,
    constants: CONSTANTS, params: { debt_payoff_hurdle_apr: 0.06 }, yields: null,
    ladder: ladderWith(0, null), investableUsd: 50_000, ...over,
  }
}

function factsFor(src: NextDollarSources, skipped: Partial<Record<FactKey, string>> = {}): NextDollarFacts {
  const p = src.profile
  return {
    known: {
      monthly_expenses: src.ladder?.tier1.status !== 'needs_expenses',
      employer_match: src.benefits.matchAvailable != null,
      debts: src.debts.length > 0 || src.noHighInterestDebtConfirmed,
      health_plan: p.health_plan_type != null,
      household_income: p.magi_estimate_usd != null,
      filing_status: p.filing_status != null,
      ytd_ira: p.ytd_ira_contribution_usd != null,
      ytd_401k: p.ytd_401k_employee_usd != null,
    },
    skipped,
    systemReady: { hsa: src.constants != null, roth_ira: src.constants != null, trad_401k: src.constants != null },
  }
}

const CTX: PlainContext = { tier1ShortUsd: null, tier1TargetUsd: null, debtAprPct: null, debtBalanceUsd: null, hsaRemainingUsd: null, iraRemainingUsd: null, k401RemainingUsd: null }
const cardFor = (src: NextDollarSources, skipped: Partial<Record<FactKey, string>> = {}, ctx: Partial<PlainContext> = {}) =>
  buildNextDollarCard(rankNextDollar(nextDollarInputsFrom(src)), factsFor(src, skipped), { ...CTX, ...ctx })

const FULL_PROFILE = {
  magi_estimate_usd: 90_000, filing_status: 'single' as const, health_plan_type: 'ppo' as const,
  ytd_ira_contribution_usd: 0, ytd_401k_employee_usd: 5_000,
}
const fundedNoDebtMatchNone = (extra: Partial<NextDollarSources> = {}) => sources({
  ladder: ladderWith(30_000, 3_000),
  benefits: { ...EMPTY_EMPLOYER_BENEFITS, matchAvailable: false },
  noHighInterestDebtConfirmed: true,
  ...extra,
})

describe('constants (product defaults)', () => {
  it('have the documented defaults', () => {
    expect(RAISE_MIN_INCREASE).toBe(0.03)
    expect(RAISE_TAKE_HOME_FRACTION).toBe(0.70)
    expect(RAISE_SAVE_SHARE).toBe(0.50)
    expect(DEPOSIT_ROUND_USD).toBe(5)
  })
})

describe('one emergency-fund definition: the ladder’s Tier 1 Safety', () => {
  it('waterfall emergency inputs ARE the ladder’s held / target', () => {
    const ladder = ladderWith(10_000, 3_000)       // target 18,000
    const i = nextDollarInputsFrom(sources({ ladder, profile: { liquid_cash_usd: 999_999 } }))
    expect(i.emergencyFundUsd).toBe(ladder.tier1.heldUsd)
    expect(i.emergencyTargetUsd).toBe(18_000)
  })
  it('expenses unknown → the emergency step needs data (never a guess)', () => {
    const i = nextDollarInputsFrom(sources())
    expect(i.emergencyFundUsd).toBeNull()
    expect(i.emergencyTargetUsd).toBeNull()
  })
  it('the /advisor checkup uses the same ladder and mapper, not liquid_cash_usd', () => {
    const src = read('lib/actions/wealth-checkup.ts')
    expect(src).toContain('nextDollarInputsFrom(')
    expect(src).toContain('loadLadder(supabase, user.id)')
    expect(src).not.toMatch(/liquid_cash_usd\s*<\s*emergencyTarget/)
    expect(src).not.toMatch(/emergencyFundUsd:\s*profile\.liquid_cash_usd/)
  })
})

describe('honest inputs', () => {
  it('no debt rows is UNKNOWN unless the person said "none"', () => {
    expect(nextDollarInputsFrom(sources()).highInterestDebtAprPct).toBeNull()
    expect(nextDollarInputsFrom(sources({ noHighInterestDebtConfirmed: true })).highInterestDebtAprPct).toBe(0)
  })
  it('IRA room needs this year’s contributions (no silent assumption of $0)', () => {
    expect(nextDollarInputsFrom(sources({ profile: { magi_estimate_usd: 90_000, filing_status: 'single' } })).iraRemainingUsd).toBeNull()
    expect(nextDollarInputsFrom(sources({ profile: { ytd_ira_contribution_usd: 1_000 } })).iraRemainingUsd).toBe(6_000)
  })
})

describe('the card walks the waterfall in order', () => {
  it('a blank profile is asked about essentials first — never told to invest', () => {
    const c = cardFor(sources())
    expect(c.kind).toBe('question')
    if (c.kind === 'question') expect(c.fact).toBe('monthly_expenses')
    // bestNext alone would have jumped to taxable investing:
    expect(rankNextDollar(nextDollarInputsFrom(sources())).bestNext?.id).toBe('taxable_or_cash')
  })
  it('Tier 1 short → "Finish your safety cushion" with Add money', () => {
    const c = cardFor(sources({ ladder: ladderWith(2_000, 3_000) }), {}, { tier1ShortUsd: 16_000, tier1TargetUsd: 18_000 })
    expect(c).toMatchObject({ kind: 'recommendation', stepId: 'emergency_fund', action: 'add_money' })
    if (c.kind === 'recommendation') expect(c.body).toContain('$16,000 short of the $18,000')
  })
  it('Tier 1 funded → asks about the employer match next', () => {
    const c = cardFor(sources({ ladder: ladderWith(30_000, 3_000) }))
    expect(c).toMatchObject({ kind: 'question', fact: 'employer_match' })
  })
  it('"not sure" moves on to the next question and is reported later', () => {
    const src = sources({ ladder: ladderWith(30_000, 3_000) })
    const c = cardFor(src, { employer_match: '2026-11-24' })
    expect(c).toMatchObject({ kind: 'question', fact: 'debts' })
    const done = cardFor({ ...src, noHighInterestDebtConfirmed: true, profile: FULL_PROFILE }, { employer_match: 'x' })
    expect(done.kind).toBe('recommendation')
    if (done.kind === 'recommendation') expect(done.skippedChecks).toContain('an employer match')
  })
  it('a free match is recommended before investing', () => {
    const c = cardFor(sources({ ladder: ladderWith(30_000, 3_000), benefits: { ...EMPTY_EMPLOYER_BENEFITS, matchAvailable: true }, noHighInterestDebtConfirmed: true }))
    expect(c).toMatchObject({ kind: 'recommendation', stepId: 'employer_match' })
  })
  it('a 25%+ credit card jumps ahead of even the match', () => {
    const c = cardFor(sources({
      ladder: ladderWith(30_000, 3_000), benefits: { ...EMPTY_EMPLOYER_BENEFITS, matchAvailable: true },
      debts: [{ id: 'd', name: 'Card', debtType: 'credit_card', balanceUsd: 4_000, aprPct: 27.9, minimumPaymentUsd: null, payoffPriority: null }],
    }), {}, { debtAprPct: 27.9, debtBalanceUsd: 4_000 })
    expect(c).toMatchObject({ kind: 'recommendation', stepId: 'high_interest_debt' })
    if (c.kind === 'recommendation') expect(c.title).toBe('Pay down your 27.9% debt')
  })
  it('HSA when on a high-deductible plan', () => {
    const c = cardFor(fundedNoDebtMatchNone({ profile: { ...FULL_PROFILE, health_plan_type: 'hdhp' } }), {}, { hsaRemainingUsd: 4_300 })
    expect(c).toMatchObject({ kind: 'recommendation', stepId: 'hsa' })
  })
  it('Roth: three plain questions, then a direct Roth under the income limit', () => {
    const asked = cardFor(fundedNoDebtMatchNone({ profile: { health_plan_type: 'ppo' } }))
    expect(asked).toMatchObject({ kind: 'question', fact: 'household_income' })
    const c = cardFor(fundedNoDebtMatchNone({ profile: FULL_PROFILE }), {}, { iraRemainingUsd: 7_000 })
    expect(c).toMatchObject({ kind: 'recommendation', stepId: 'roth_ira', title: 'Add to a Roth IRA' })
  })
  it('over the Roth income limit → "ask a tax pro", never a how-to', () => {
    const c = cardFor(fundedNoDebtMatchNone({ profile: { ...FULL_PROFILE, magi_estimate_usd: 400_000 } }))
    expect(c.kind === 'recommendation' && c.title).toMatch(/tax pro/)
  })
  it('missing tax limits skip those steps honestly instead of asking the person', () => {
    const src = fundedNoDebtMatchNone({ constants: null, profile: FULL_PROFILE })
    const c = cardFor(src)
    expect(c).toMatchObject({ kind: 'recommendation', stepId: 'taxable_or_cash' })
    if (c.kind === 'recommendation') {
      expect(c.skippedChecks).toEqual(expect.arrayContaining(['a Roth IRA', 'your 401(k)']))
    }
  })
  it('never recommends trading', () => {
    for (const src of [sources(), fundedNoDebtMatchNone({ profile: FULL_PROFILE })]) {
      const c = cardFor(src)
      expect(c.stepId).not.toBe('paper_bankroll')
    }
  })
  it('every askable fact belongs to a step, and progress counts answered facts', () => {
    expect(new Set(Object.values(STEP_FACTS).flat())).toEqual(new Set(ALL_FACTS))
    const c = cardFor(sources({ ladder: ladderWith(30_000, 3_000) }))
    if (c.kind === 'question') expect(c.progress).toEqual({ answered: 1, total: ALL_FACTS.length })
  })
})

describe('plain English for Simple mode', () => {
  const JARGON = /\b(MAGI|HYSA|T-bill|pro-rata|triple-tax|deferral|waterfall|notional)\b/i
  it('questions avoid jargon', () => {
    for (const q of Object.values(QUESTIONS)) {
      expect(`${q.prompt} ${q.help ?? ''}`).not.toMatch(JARGON)
    }
  })
  it('recommendations avoid jargon', () => {
    const cases = [
      cardFor(sources({ ladder: ladderWith(2_000, 3_000) })),
      cardFor(fundedNoDebtMatchNone({ profile: FULL_PROFILE })),
      cardFor(fundedNoDebtMatchNone({ profile: { ...FULL_PROFILE, magi_estimate_usd: 400_000 } })),
    ]
    for (const c of cases) if (c.kind === 'recommendation') expect(`${c.title} ${c.body}`).not.toMatch(JARGON)
  })
})

describe('raise prompt (#6)', () => {
  const goal = { id: 'g1', name: 'House', monthlyContributionUsd: 500 }
  it(`under ${RAISE_MIN_INCREASE * 100}% is not a raise`, () => {
    expect(raisePromptFor({ incomeNowUsd: 82_000, baselineUsd: 80_000, goal })).toBeNull()
  })
  it('suggests half of the after-tax raise per month, rounded', () => {
    const p = raisePromptFor({ incomeNowUsd: 90_000, baselineUsd: 80_000, goal })!
    // 10,000 × 0.70 × 0.50 / 12 = 291.67 → 290
    expect(p).toMatchObject({ raiseUsd: 10_000, increaseUsd: 290, currentMonthlyUsd: 500, suggestedMonthlyUsd: 790 })
  })
  it('needs a baseline and a goal', () => {
    expect(raisePromptFor({ incomeNowUsd: 90_000, baselineUsd: null, goal })).toBeNull()
    expect(raisePromptFor({ incomeNowUsd: 90_000, baselineUsd: 80_000, goal: null })).toBeNull()
  })
  it('a pay cut never prompts', () => {
    expect(raisePromptFor({ incomeNowUsd: 70_000, baselineUsd: 80_000, goal })).toBeNull()
  })
})

// ─── Writes, with a recording fake ───────────────────────────────────────────

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  writes: [] as Array<{ table: string; op: string; row: Record<string, unknown> }>,
}))
vi.mock('@/lib/advisory/yields', () => ({ fetchCurrentYields: async () => null }))

function client() {
  return {
    from: (table: string) => {
      const rows = () => db.tables[table] ?? []
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'order', 'limit', 'not', 'gte']) c[m] = () => c
      c.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null })
      c.upsert = async (row: Record<string, unknown>) => {
        db.writes.push({ table, op: 'upsert', row })
        db.tables[table] = [{ ...(rows()[0] ?? {}), ...row }]
        return { error: null }
      }
      c.insert = async (row: Record<string, unknown>) => {
        db.writes.push({ table, op: 'insert', row })
        db.tables[table] = [...rows(), row]
        return { error: null }
      }
      c.update = (row: Record<string, unknown>) => ({
        eq: () => ({ select: async () => { db.writes.push({ table, op: 'update', row }); return { data: [{ id: 'g1' }], error: null } } }),
      })
      c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(ok)
      return c
    },
  } as never
}

beforeEach(() => { db.tables = {}; db.writes = [] })

describe('answers are planning facts in their existing homes — never trades', () => {
  it('validates answers', async () => {
    const { parseFactAnswer } = await import('@/lib/advisory/next-dollar-data')
    expect(parseFactAnswer({ fact: 'monthly_expenses', amount: -1 })).toBeNull()
    expect(parseFactAnswer({ fact: 'debts', balanceUsd: 100, aprPct: 140 })).toBeNull()
    expect(parseFactAnswer({ fact: 'nope', amount: 1 })).toBeNull()
    expect(parseFactAnswer({ fact: 'health_plan', choice: 'hdhp' })).toEqual({ fact: 'health_plan', choice: 'hdhp' })
    expect(parseFactAnswer({ fact: 'ytd_ira', amount: '0' })).toEqual({ fact: 'ytd_ira', amount: 0 })
  })
  it('"no workplace plan" records no match and skips the 401(k) question', async () => {
    const { answerNextDollarFact } = await import('@/lib/advisory/next-dollar-data')
    await answerNextDollarFact(client(), 'u1', { fact: 'employer_match', choice: 'no_plan' })
    expect(db.writes.find(w => w.table === 'employer_benefits')!.row).toMatchObject({ user_id: 'u1', match_available: false })
    const st = db.tables.next_dollar_state[0]
    expect((st.skipped as Record<string, string>).ytd_401k).toBeTruthy()
  })
  it('"no high-interest debt" is remembered; a balance becomes a debt row', async () => {
    const { answerNextDollarFact } = await import('@/lib/advisory/next-dollar-data')
    await answerNextDollarFact(client(), 'u1', { fact: 'debts', none: true })
    expect(db.tables.next_dollar_state[0].no_high_interest_debt_confirmed_at).toBeTruthy()
    await answerNextDollarFact(client(), 'u1', { fact: 'debts', balanceUsd: 3_000, aprPct: 22 })
    expect(db.writes.find(w => w.table === 'debt_accounts')!.row).toMatchObject({ user_id: 'u1', balance_usd: 3_000, apr_pct: 22 })
  })
  it('an answer clears an earlier "not sure"', async () => {
    const { answerNextDollarFact } = await import('@/lib/advisory/next-dollar-data')
    db.tables.next_dollar_state = [{ user_id: 'u1', skipped: { health_plan: 'x' } }]
    await answerNextDollarFact(client(), 'u1', { fact: 'health_plan', choice: 'hdhp' })
    expect(db.tables.next_dollar_state[0].skipped).toEqual({})
    expect(db.writes.find(w => w.table === 'financial_profile')!.row).toMatchObject({ health_plan_type: 'hdhp' })
  })
  it('the first income seen becomes the baseline (no prompt for it)', async () => {
    const { loadNextDollarView } = await import('@/lib/advisory/next-dollar-data')
    db.tables.financial_profile = [{ magi_estimate_usd: 80_000 }]
    db.tables.household_goals = [{ id: 'g1', name: 'House', monthly_contribution_usd: 500 }]
    const v = await loadNextDollarView(client(), 'u1', null)
    expect(v.raise).toBeNull()
    expect(db.tables.next_dollar_state[0].income_baseline_usd).toBe(80_000)
  })
  it('accepting the raise sets the goal deposit and moves the baseline; dismissing only moves the baseline', async () => {
    const { resolveRaisePrompt } = await import('@/lib/advisory/next-dollar-data')
    const seed = () => {
      db.tables = {
        financial_profile: [{ magi_estimate_usd: 90_000 }],
        household_goals: [{ id: 'g1', name: 'House', monthly_contribution_usd: 500 }],
        next_dollar_state: [{ user_id: 'u1', skipped: {}, income_baseline_usd: 80_000 }],
      }
      db.writes = []
    }
    seed()
    const ok = await resolveRaisePrompt(client(), 'u1', true)
    expect(ok).toMatchObject({ ok: true, monthlyUsd: 790 })
    expect(db.writes.find(w => w.table === 'household_goals')!.row).toMatchObject({ monthly_contribution_usd: 790 })
    expect(db.tables.next_dollar_state[0].income_baseline_usd).toBe(90_000)
    seed()
    await resolveRaisePrompt(client(), 'u1', false)
    expect(db.writes.some(w => w.table === 'household_goals')).toBe(false)
    expect(db.tables.next_dollar_state[0].income_baseline_usd).toBe(90_000)
  })
  it('no file in this feature touches positions or trade execution', () => {
    for (const f of ['lib/advisory/next-dollar-data.ts', 'lib/actions/next-dollar.ts', 'app/api/mobile/next-dollar/route.ts']) {
      const src = read(f)
      expect(src).not.toMatch(/paper_positions|executeFundTrades|submitOrder|adapter\.execute/)
    }
  })
})

describe('wiring + contracts', () => {
  it('Simple Home (web) and the phone Home show the card', () => {
    expect(read('app/(app)/dashboard/simple-dashboard.tsx')).toContain('<NextDollarCard')
    expect(read('lib/actions/simple-dashboard.ts')).toContain('loadNextDollarView(')
    expect(read('lib/simple/mobile-data.ts')).toContain('loadNextDollarView(')
    expect(read('apps/mobile/app/(tabs)/index.tsx')).toContain('<NextDollarCard')
  })
  it('the phone endpoint is bearer-authenticated', () => {
    const src = read('app/api/mobile/next-dollar/route.ts')
    expect(src).toContain('userClientFromBearer')
    expect(src).not.toContain('createAdminClient')
  })
  it('getDebtAccounts no longer orders by the missing created_at column', () => {
    expect(read('lib/actions/benefits-debt.ts')).not.toContain("order('created_at'")
  })
  it('migration 20260704o: next_dollar_state with owner RLS', () => {
    const sql = read('supabase/migrations/20260704o_next_dollar.sql')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.next_dollar_state')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toMatch(/USING \(user_id = auth\.uid\(\)\) WITH CHECK \(user_id = auth\.uid\(\)\)/)
  })
})
