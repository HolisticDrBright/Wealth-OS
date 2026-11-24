/**
 * Best-next-dollar data layer (roadmap #1) — client-agnostic: callers pass a
 * Supabase client scoped to the user (cookie session on the web, bearer
 * client on the phone). Every read degrades to "unknown" rather than failing;
 * every write is a planning fact or a goal deposit change — NEVER a trade.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadTaxConstants, loadKbParameters } from '@/lib/advisory/constants'
import { fetchCurrentYields } from '@/lib/advisory/yields'
import { rankNextDollar, type NextDollarPlan } from '@/lib/advisory/next-dollar'
import { nextDollarInputsFrom, type NextDollarSources } from '@/lib/advisory/next-dollar-inputs'
import {
  buildNextDollarCard, raisePromptFor, ALL_FACTS, type NextDollarCard, type NextDollarFacts,
  type FactKey, type RaisePrompt,
} from '@/lib/advisory/next-dollar-card'
import { employerBenefitsFromRow, debtAccountFromRow } from '@/lib/advisory/benefits-debt'
import type { FinancialProfile } from '@/lib/advisory/types'
import { loadLadder, saveMonthlyExpenses } from '@/lib/allocation/ladder-data'
import type { Ladder } from '@/lib/allocation/ladder'

const PROFILE_FIELDS = [
  'filing_status', 'magi_estimate_usd', 'w2_wages_usd', 'health_plan_type', 'monthly_essential_expenses_usd',
  'ytd_401k_employee_usd', 'ytd_ira_contribution_usd', 'ytd_hsa_contribution_usd', 'liquid_cash_usd',
].join(', ')

interface NextDollarState {
  noDebtConfirmedAt: string | null
  skipped: Partial<Record<FactKey, string>>
  incomeBaselineUsd: number | null
}

async function loadState(supabase: SupabaseClient, userId: string): Promise<NextDollarState> {
  const { data, error } = await supabase.from('next_dollar_state')
    .select('no_high_interest_debt_confirmed_at, skipped, income_baseline_usd')
    .eq('user_id', userId).maybeSingle()
  if (error || !data) return { noDebtConfirmedAt: null, skipped: {}, incomeBaselineUsd: null }
  const row = data as { no_high_interest_debt_confirmed_at: string | null; skipped: Record<string, string> | null; income_baseline_usd: number | string | null }
  return {
    noDebtConfirmedAt: row.no_high_interest_debt_confirmed_at,
    skipped: (row.skipped ?? {}) as Partial<Record<FactKey, string>>,
    incomeBaselineUsd: row.income_baseline_usd == null ? null : Number(row.income_baseline_usd),
  }
}

async function patchState(supabase: SupabaseClient, userId: string, patch: Record<string, unknown>) {
  return supabase.from('next_dollar_state')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
}

/** Household income for the raise prompt: the household estimate first, else W-2 wages. */
export function incomeOf(profile: Partial<FinancialProfile>): number | null {
  const v = profile.magi_estimate_usd ?? profile.w2_wages_usd ?? null
  return v == null ? null : Number(v)
}

export interface NextDollarView {
  card: NextDollarCard
  raise: RaisePrompt | null
  /** The full waterfall (Pro / "see all steps"). */
  plan: NextDollarPlan
  disclaimer: string
}

export interface LoadedSources extends NextDollarSources {
  state: NextDollarState
  primaryGoal: { id: string; name: string; monthlyContributionUsd: number } | null
}

export async function loadNextDollarSources(supabase: SupabaseClient, userId: string, ladder?: Ladder | null): Promise<LoadedSources> {
  const [profileRes, benefitsRes, debtsRes, state, constants, params, yields, ladderLoaded, assetsRes, goalsRes] = await Promise.all([
    supabase.from('financial_profile').select(PROFILE_FIELDS).eq('user_id', userId).maybeSingle(),
    supabase.from('employer_benefits').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('debt_accounts').select('*').eq('user_id', userId),
    loadState(supabase, userId),
    loadTaxConstants(supabase).catch(() => null),
    loadKbParameters(supabase).catch(() => null),
    fetchCurrentYields().catch(() => null),
    ladder !== undefined ? Promise.resolve(ladder) : loadLadder(supabase, userId).catch(() => null),
    supabase.from('assets').select('current_value').eq('user_id', userId),
    supabase.from('household_goals')
      .select('id, name, monthly_contribution_usd, target_date, status, households!inner(owner_user_id)')
      .eq('status', 'active').eq('households.owner_user_id', userId)
      .order('target_date', { ascending: true, nullsFirst: false }),
  ])
  const profile = ((profileRes.data ?? {}) as Partial<FinancialProfile>)
  const goals = (goalsRes.data ?? []) as Array<{ id: string; name: string; monthly_contribution_usd: number | string | null }>
  return {
    profile,
    benefits: employerBenefitsFromRow(benefitsRes.data as Record<string, unknown> | null),
    debts: ((debtsRes.data ?? []) as Array<Record<string, unknown>>).map(debtAccountFromRow),
    noHighInterestDebtConfirmed: state.noDebtConfirmedAt != null,
    constants, params, yields,
    ladder: ladderLoaded,
    investableUsd: ((assetsRes.data ?? []) as Array<{ current_value: number | null }>).reduce((s, a) => s + (a.current_value ?? 0), 0),
    state,
    primaryGoal: goals[0]
      ? { id: goals[0].id, name: goals[0].name, monthlyContributionUsd: Number(goals[0].monthly_contribution_usd ?? 0) }
      : null,
  }
}

export function factsOf(src: LoadedSources): NextDollarFacts {
  const p = src.profile
  const known: Record<FactKey, boolean> = {
    monthly_expenses: p.monthly_essential_expenses_usd != null,
    employer_match: src.benefits.matchAvailable != null,
    debts: src.debts.some(d => d.debtType !== 'mortgage') || src.noHighInterestDebtConfirmed,
    health_plan: p.health_plan_type != null,
    household_income: p.magi_estimate_usd != null,
    filing_status: p.filing_status != null,
    ytd_ira: p.ytd_ira_contribution_usd != null,
    ytd_401k: p.ytd_401k_employee_usd != null,
  }
  const c = src.constants
  return {
    known,
    skipped: src.state.skipped,
    systemReady: {
      hsa: c != null && c.hsa_limit_single != null && c.hsa_limit_family != null,
      roth_ira: c != null && c.ira_limit != null && c.roth_phaseout_single_start != null && c.roth_phaseout_mfj_start != null,
      trad_401k: c != null && c.solo401k_employee != null,
    },
  }
}

/** PURE assembly from loaded sources — the card, the raise prompt and the plan. */
export function nextDollarViewFrom(src: LoadedSources): NextDollarView {
  const inputs = nextDollarInputsFrom(src)
  const plan = rankNextDollar(inputs)
  const t1 = src.ladder?.tier1
  const card = buildNextDollarCard(plan, factsOf(src), {
    tier1ShortUsd: t1 && t1.targetUsd != null ? t1.shortfallUsd : null,
    tier1TargetUsd: t1?.targetUsd ?? null,
    debtAprPct: inputs.highInterestDebtAprPct,
    debtBalanceUsd: inputs.highInterestDebtBalanceUsd,
    hsaRemainingUsd: inputs.hsaRemainingUsd,
    iraRemainingUsd: inputs.iraRemainingUsd,
    k401RemainingUsd: inputs.employee401kRemainingUsd,
  })
  const raise = raisePromptFor({
    incomeNowUsd: incomeOf(src.profile),
    baselineUsd: src.state.incomeBaselineUsd,
    goal: src.primaryGoal,
  })
  return {
    card, raise, plan,
    disclaimer: 'Planning guidance, not personal advice. Nothing moves until you act.',
  }
}

export async function loadNextDollarView(supabase: SupabaseClient, userId: string, ladder?: Ladder | null): Promise<NextDollarView> {
  const src = await loadNextDollarSources(supabase, userId, ladder)
  // First time we see an income, it becomes the baseline (no prompt for it).
  const income = incomeOf(src.profile)
  if (income != null && src.state.incomeBaselineUsd == null) {
    await patchState(supabase, userId, { income_baseline_usd: income, income_baseline_at: new Date().toISOString() })
      .then(() => {}, () => {})
    src.state.incomeBaselineUsd = income
  }
  return nextDollarViewFrom(src)
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export type FactAnswer =
  | { fact: 'monthly_expenses' | 'household_income' | 'ytd_ira' | 'ytd_401k'; amount: number }
  | { fact: 'employer_match'; choice: 'yes' | 'no' | 'no_plan' }
  | { fact: 'debts'; none: true }
  | { fact: 'debts'; balanceUsd: number; aprPct: number }
  | { fact: 'health_plan'; choice: 'hdhp' | 'other' | 'none' }
  | { fact: 'filing_status'; choice: 'single' | 'mfj' | 'mfs' | 'hoh' }

export interface WriteResult { ok: boolean; error?: string }

const okAmount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

async function upsertProfile(supabase: SupabaseClient, userId: string, patch: Record<string, unknown>): Promise<WriteResult> {
  const { error } = await supabase.from('financial_profile')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** Validate a raw answer from a client into a FactAnswer (null = invalid). */
export function parseFactAnswer(raw: Record<string, unknown>): FactAnswer | null {
  const fact = raw.fact
  const amount = typeof raw.amount === 'string' ? Number(raw.amount) : raw.amount
  switch (fact) {
    case 'monthly_expenses': case 'household_income': case 'ytd_ira': case 'ytd_401k':
      return okAmount(amount) ? { fact, amount } : null
    case 'employer_match':
      return ['yes', 'no', 'no_plan'].includes(String(raw.choice)) ? { fact, choice: raw.choice as 'yes' | 'no' | 'no_plan' } : null
    case 'health_plan':
      return ['hdhp', 'other', 'none'].includes(String(raw.choice)) ? { fact, choice: raw.choice as 'hdhp' | 'other' | 'none' } : null
    case 'filing_status':
      return ['single', 'mfj', 'mfs', 'hoh'].includes(String(raw.choice)) ? { fact, choice: raw.choice as 'single' | 'mfj' | 'mfs' | 'hoh' } : null
    case 'debts': {
      if (raw.none === true) return { fact, none: true }
      const balanceUsd = Number(raw.balanceUsd)
      const aprPct = Number(raw.aprPct)
      return Number.isFinite(balanceUsd) && balanceUsd > 0 && Number.isFinite(aprPct) && aprPct >= 0 && aprPct <= 100
        ? { fact, balanceUsd, aprPct } : null
    }
    default:
      return null
  }
}

export async function answerNextDollarFact(supabase: SupabaseClient, userId: string, a: FactAnswer): Promise<WriteResult> {
  let res: WriteResult
  switch (a.fact) {
    case 'monthly_expenses':
      res = await saveMonthlyExpenses(supabase, userId, a.amount)
      break
    case 'household_income':
      res = await upsertProfile(supabase, userId, { magi_estimate_usd: a.amount })
      break
    case 'ytd_ira':
      res = await upsertProfile(supabase, userId, { ytd_ira_contribution_usd: a.amount })
      break
    case 'ytd_401k':
      res = await upsertProfile(supabase, userId, { ytd_401k_employee_usd: a.amount })
      break
    case 'health_plan':
      res = await upsertProfile(supabase, userId, { health_plan_type: a.choice })
      break
    case 'filing_status':
      res = await upsertProfile(supabase, userId, { filing_status: a.choice })
      break
    case 'employer_match': {
      const { error } = await supabase.from('employer_benefits').upsert(
        { user_id: userId, match_available: a.choice === 'yes', updated_at: new Date().toISOString() },
        { onConflict: 'user_id' })
      res = error ? { ok: false, error: error.message } : { ok: true }
      // No workplace plan → there is no 401(k) to ask about.
      if (res.ok && a.choice === 'no_plan') await skipNextDollarFact(supabase, userId, 'ytd_401k')
      break
    }
    case 'debts': {
      if ('none' in a) {
        const { error } = await patchState(supabase, userId, { no_high_interest_debt_confirmed_at: new Date().toISOString() })
        res = error ? { ok: false, error: error.message } : { ok: true }
      } else {
        const { error } = await supabase.from('debt_accounts').insert({
          user_id: userId, name: 'Debt from best-next-dollar', debt_type: 'other',
          balance_usd: a.balanceUsd, apr_pct: a.aprPct, updated_at: new Date().toISOString(),
        })
        res = error ? { ok: false, error: error.message } : { ok: true }
      }
      break
    }
  }
  // An answer replaces an earlier "not sure".
  if (res.ok) await unskip(supabase, userId, a.fact)
  return res
}

async function unskip(supabase: SupabaseClient, userId: string, fact: FactKey) {
  const state = await loadState(supabase, userId)
  if (!state.skipped[fact]) return
  const skipped = { ...state.skipped }
  delete skipped[fact]
  await patchState(supabase, userId, { skipped }).then(() => {}, () => {})
}

export async function skipNextDollarFact(supabase: SupabaseClient, userId: string, fact: FactKey): Promise<WriteResult> {
  if (!ALL_FACTS.includes(fact)) return { ok: false, error: 'unknown question' }
  const state = await loadState(supabase, userId)
  const { error } = await patchState(supabase, userId, { skipped: { ...state.skipped, [fact]: new Date().toISOString() } })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** "My income changed": updates the household income; the baseline stays, so a raise prompts. */
export async function updateIncome(supabase: SupabaseClient, userId: string, amountUsd: number): Promise<WriteResult> {
  if (!okAmount(amountUsd)) return { ok: false, error: 'Income must be zero or more' }
  return upsertProfile(supabase, userId, { magi_estimate_usd: amountUsd })
}

/**
 * Accept the raise prompt (set the primary goal's deposit to the suggested
 * amount) or dismiss it. Either way the current income becomes the baseline,
 * so the prompt doesn't repeat until the next raise. Never a trade.
 */
export async function resolveRaisePrompt(
  supabase: SupabaseClient, userId: string, accept: boolean,
): Promise<WriteResult & { monthlyUsd?: number }> {
  const src = await loadNextDollarSources(supabase, userId, null)
  const prompt = raisePromptFor({ incomeNowUsd: incomeOf(src.profile), baselineUsd: src.state.incomeBaselineUsd, goal: src.primaryGoal })
  if (!prompt) return { ok: false, error: 'No raise to act on' }
  if (accept) {
    const { error, data } = await supabase.from('household_goals')
      .update({ monthly_contribution_usd: prompt.suggestedMonthlyUsd, updated_at: new Date().toISOString() })
      .eq('id', prompt.goalId).select('id')
    if (error) return { ok: false, error: error.message }
    if (!data?.length) return { ok: false, error: 'goal not found' }
  }
  const { error } = await patchState(supabase, userId, {
    income_baseline_usd: prompt.incomeNowUsd, income_baseline_at: new Date().toISOString(),
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, monthlyUsd: accept ? prompt.suggestedMonthlyUsd : prompt.currentMonthlyUsd }
}
