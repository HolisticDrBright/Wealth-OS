/**
 * The "best next dollar" Home card (roadmap #1) — PURE.
 *
 * rankNextDollar's `bestNext` is the first RECOMMENDED step, which skips steps
 * that are missing data. On a beginner's Home screen that would jump straight
 * to "invest in taxable" before we know whether they have a 25% credit card or
 * a free employer match. So the card walks the waterfall IN ORDER:
 *
 *   satisfied / not applicable → keep going
 *   missing a fact the person can tell us (and not skipped) → ask THAT, one question
 *   missing system data (tax limits not loaded) → skip it, say so
 *   recommended → show it, in plain English
 *
 * Plus the "save part of your raise" prompt (roadmap #6). Nothing here moves money.
 */

import type { NextDollarPlan, NextDollarStep } from '@/lib/advisory/next-dollar'
import {
  RAISE_MIN_INCREASE, RAISE_TAKE_HOME_FRACTION, RAISE_SAVE_SHARE, DEPOSIT_ROUND_USD,
} from '@/lib/config/product-defaults'

export type FactKey =
  | 'monthly_expenses' | 'employer_match' | 'debts' | 'health_plan'
  | 'household_income' | 'filing_status' | 'ytd_ira' | 'ytd_401k'

export const ALL_FACTS: FactKey[] = [
  'monthly_expenses', 'employer_match', 'debts', 'health_plan',
  'household_income', 'filing_status', 'ytd_ira', 'ytd_401k',
]

/** Which person-answerable facts each step needs, in the order we ask them. */
export const STEP_FACTS: Record<string, FactKey[]> = {
  emergency_fund: ['monthly_expenses'],
  employer_match: ['employer_match'],
  high_interest_debt: ['debts'],
  hsa: ['health_plan'],
  roth_ira: ['household_income', 'filing_status', 'ytd_ira'],
  trad_401k: ['ytd_401k'],
}

export interface NextDollarFacts {
  known: Record<FactKey, boolean>
  /** Facts the person chose "not sure / skip" for. */
  skipped: Partial<Record<FactKey, string>>
  /** System data present (current-year tax limits) per step that needs it. */
  systemReady: { hsa: boolean; roth_ira: boolean; trad_401k: boolean }
}

export interface Choice { value: string; label: string }

export interface QuestionSpec {
  prompt: string
  help: string | null
  input: 'number' | 'choice' | 'debt'
  choices?: Choice[]
  /** Label for the "I don't know / skip" button. */
  skipLabel: string
}

export const QUESTIONS: Record<FactKey, QuestionSpec> = {
  monthly_expenses: {
    prompt: 'What do you spend each month on the essentials?',
    help: 'Rent or mortgage, food, utilities, insurance and minimum debt payments. A rough number is fine.',
    input: 'number', skipLabel: 'Skip for now',
  },
  employer_match: {
    prompt: 'Does your employer add money when you save in a 401(k) or similar plan?',
    help: 'Often called a "match" — your benefits site or HR can tell you.',
    input: 'choice',
    choices: [
      { value: 'yes', label: 'Yes, they match' },
      { value: 'no', label: 'No match' },
      { value: 'no_plan', label: "I don't have a workplace plan" },
    ],
    skipLabel: 'Not sure',
  },
  debts: {
    prompt: 'Do you have credit-card or other debt charging more than 6% interest?',
    help: 'Car loans, personal loans and credit cards count. Your mortgage usually doesn’t.',
    input: 'debt', skipLabel: 'Not sure',
  },
  health_plan: {
    prompt: 'Is your health insurance a high-deductible plan?',
    help: 'These usually come with an HSA (health savings account). Your insurance card or HR can tell you.',
    input: 'choice',
    choices: [
      { value: 'hdhp', label: 'Yes, high-deductible' },
      { value: 'other', label: 'No, a regular plan' },
      { value: 'none', label: 'No health insurance' },
    ],
    skipLabel: 'Not sure',
  },
  household_income: {
    prompt: 'Roughly what does your household earn in a year, before tax?',
    help: 'It decides which retirement accounts you can use. A round number is fine.',
    input: 'number', skipLabel: 'Skip for now',
  },
  filing_status: {
    prompt: 'How do you file your taxes?',
    help: null,
    input: 'choice',
    choices: [
      { value: 'single', label: 'Single' },
      { value: 'mfj', label: 'Married, filing together' },
      { value: 'mfs', label: 'Married, filing separately' },
      { value: 'hoh', label: 'Head of household' },
    ],
    skipLabel: 'Not sure',
  },
  ytd_ira: {
    prompt: 'How much have you put into an IRA so far this year?',
    help: 'Enter 0 if none.',
    input: 'number', skipLabel: 'Not sure',
  },
  ytd_401k: {
    prompt: 'How much have you put into a 401(k) from your paycheck so far this year?',
    help: 'Enter 0 if none. Your latest pay stub shows it.',
    input: 'number', skipLabel: "I don't have one",
  },
}

/** Why the step is checked at that point in the order — shown under each question. */
const WHY_FIRST: Record<string, string> = {
  emergency_fund: 'A safety cushion comes before everything else — it keeps a surprise bill from turning into debt.',
  employer_match: 'A match is free money: an instant 50–100% return that no investment can beat.',
  high_interest_debt: 'Paying off high-interest debt is a guaranteed return equal to its interest rate.',
  hsa: 'An HSA is the only account that is tax-free going in, growing and coming out (for medical costs).',
  roth_ira: 'A Roth IRA grows tax-free for retirement — we need these to know if you can use one.',
  trad_401k: 'Saving more in a 401(k) lowers your taxes now.',
}

/** Plain-English name of each check (for "we skipped …"). */
export const STEP_NAME: Record<string, string> = {
  emergency_fund: 'your safety cushion',
  employer_match: 'an employer match',
  high_interest_debt: 'high-interest debt',
  hsa: 'an HSA',
  roth_ira: 'a Roth IRA',
  trad_401k: 'your 401(k)',
}

export type CardAction = 'add_money' | 'none'

export type NextDollarCard =
  | {
      kind: 'question'
      stepId: string
      fact: FactKey
      why: string
      question: QuestionSpec
      /** Facts already answered / total facts the waterfall can use. */
      progress: { answered: number; total: number }
    }
  | {
      kind: 'recommendation'
      stepId: string
      title: string
      body: string
      action: CardAction
      /** Checks we couldn't make (skipped by the person or system data missing). */
      skippedChecks: string[]
    }

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

function plainRecommendation(step: NextDollarStep, ctx: PlainContext): { title: string; body: string; action: CardAction } {
  switch (step.id) {
    case 'emergency_fund':
      return {
        title: 'Finish your safety cushion',
        body: ctx.tier1ShortUsd != null && ctx.tier1TargetUsd != null
          ? `Your safety cushion is ${usd(ctx.tier1ShortUsd)} short of the ${usd(ctx.tier1TargetUsd)} it needs. Every new dollar goes here first.`
          : 'Your safety cushion isn’t full yet. Every new dollar goes here first.',
        action: 'add_money',
      }
    case 'employer_match':
      return {
        title: 'Get your full employer match',
        body: 'Save at least enough in your workplace plan to get every matched dollar — it’s free money. You change this on your employer’s benefits site.',
        action: 'none',
      }
    case 'high_interest_debt':
      return {
        title: ctx.debtAprPct != null ? `Pay down your ${ctx.debtAprPct.toFixed(1)}% debt` : 'Pay down high-interest debt',
        body: `Paying off ${ctx.debtBalanceUsd ? `that ${usd(ctx.debtBalanceUsd)} balance` : 'that balance'} is a guaranteed ${ctx.debtAprPct != null ? `${ctx.debtAprPct.toFixed(1)}%` : 'high'} return. Put extra money here before investing.`,
        action: 'none',
      }
    case 'hsa':
      return {
        title: 'Put money in your HSA',
        body: `${ctx.hsaRemainingUsd != null ? `${usd(ctx.hsaRemainingUsd)} of room left this year. ` : ''}Money goes in before tax, grows tax-free, and comes out tax-free for medical bills.`,
        action: 'none',
      }
    case 'roth_ira':
      return step.title.startsWith('Backdoor')
        ? {
            title: 'Ask a tax pro about a "backdoor" Roth',
            body: 'Your income is above the limit for a regular Roth IRA. There’s a workaround, but it can create a tax bill if you have other IRA money — get a CPA’s help first.',
            action: 'none',
          }
        : {
            title: 'Add to a Roth IRA',
            body: `${ctx.iraRemainingUsd != null ? `${usd(ctx.iraRemainingUsd)} of room left this year. ` : ''}You pay tax now; then it grows and comes out tax-free in retirement.`,
            action: 'none',
          }
    case 'trad_401k':
      return {
        title: 'Save more in your 401(k)',
        body: `${ctx.k401RemainingUsd != null ? `${usd(ctx.k401RemainingUsd)} of room left this year. ` : ''}It lowers your taxes now and grows for retirement.`,
        action: 'none',
      }
    default:   // taxable_or_cash
      return {
        title: 'Invest for the long term',
        body: 'You’ve covered the basics. Money you won’t need for a few years goes into your Core funds; money you need sooner stays in your safety cushion.',
        action: 'add_money',
      }
  }
}

export interface PlainContext {
  tier1ShortUsd: number | null
  tier1TargetUsd: number | null
  debtAprPct: number | null
  debtBalanceUsd: number | null
  hsaRemainingUsd: number | null
  iraRemainingUsd: number | null
  k401RemainingUsd: number | null
}

const SYSTEM_STEPS = new Set(['hsa', 'roth_ira', 'trad_401k'])

export function buildNextDollarCard(plan: NextDollarPlan, facts: NextDollarFacts, ctx: PlainContext): NextDollarCard {
  const skippedChecks: string[] = []
  const answered = ALL_FACTS.filter(f => facts.known[f]).length

  for (const step of plan.steps) {
    if (step.id === 'paper_bankroll') continue
    if (step.status === 'satisfied' || step.status === 'not_applicable') continue

    if (step.status === 'needs_data') {
      const needed = STEP_FACTS[step.id] ?? []
      const missing = needed.filter(f => !facts.known[f])
      const askable = missing.find(f => !facts.skipped[f])
      if (askable) {
        return {
          kind: 'question', stepId: step.id, fact: askable,
          why: WHY_FIRST[step.id] ?? '',
          question: QUESTIONS[askable],
          progress: { answered, total: ALL_FACTS.length },
        }
      }
      // Everything the person can tell us is answered or skipped. Either they
      // skipped it, or the system data (tax limits) isn't loaded.
      skippedChecks.push(STEP_NAME[step.id] ?? step.title)
      continue
    }

    // 'recommended'
    const plain = plainRecommendation(step, ctx)
    return { kind: 'recommendation', stepId: step.id, ...plain, skippedChecks }
  }

  // Unreachable in practice (taxable_or_cash is always recommended).
  const plain = plainRecommendation({ id: 'taxable_or_cash' } as NextDollarStep, ctx)
  return { kind: 'recommendation', stepId: 'taxable_or_cash', ...plain, skippedChecks }
}

/** True when a step is blocked only by system data, not by anything the person could answer. */
export function blockedBySystem(stepId: string, facts: NextDollarFacts): boolean {
  if (!SYSTEM_STEPS.has(stepId)) return false
  const needed = STEP_FACTS[stepId] ?? []
  return needed.every(f => facts.known[f]) && !facts.systemReady[stepId as keyof NextDollarFacts['systemReady']]
}

// ─── "Save part of your raise" (roadmap #6) ──────────────────────────────────

export interface RaisePrompt {
  incomeBeforeUsd: number
  incomeNowUsd: number
  raiseUsd: number
  goalId: string
  goalName: string
  currentMonthlyUsd: number
  increaseUsd: number
  suggestedMonthlyUsd: number
}

/**
 * When reported income rose at least RAISE_MIN_INCREASE above the last one we
 * acknowledged, suggest adding RAISE_SAVE_SHARE of the after-tax raise
 * (RAISE_TAKE_HOME_FRACTION of gross) to the primary goal's monthly deposit.
 */
export function raisePromptFor(args: {
  incomeNowUsd: number | null
  baselineUsd: number | null
  goal: { id: string; name: string; monthlyContributionUsd: number } | null
}): RaisePrompt | null {
  const { incomeNowUsd: now, baselineUsd: before, goal } = args
  if (now == null || before == null || goal == null || !(before > 0)) return null
  if (now < before * (1 + RAISE_MIN_INCREASE)) return null
  const raise = now - before
  const increase = Math.round((raise * RAISE_TAKE_HOME_FRACTION * RAISE_SAVE_SHARE / 12) / DEPOSIT_ROUND_USD) * DEPOSIT_ROUND_USD
  if (increase < DEPOSIT_ROUND_USD) return null
  const current = Math.max(0, goal.monthlyContributionUsd)
  return {
    incomeBeforeUsd: before, incomeNowUsd: now, raiseUsd: raise,
    goalId: goal.id, goalName: goal.name,
    currentMonthlyUsd: current, increaseUsd: increase, suggestedMonthlyUsd: current + increase,
  }
}

export function raisePromptText(p: RaisePrompt): string {
  return `Your income went up by about ${usd(p.raiseUsd)} a year. Saving half of what reaches your paycheck would add ` +
    `${usd(p.increaseUsd)} a month to "${p.goalName}" — from ${usd(p.currentMonthlyUsd)} to ${usd(p.suggestedMonthlyUsd)}.`
}
