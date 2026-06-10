/**
 * Contribution waterfall — the canonical savings priority order:
 * (1) 401(k) up to the employer match (free money),
 * (2) HSA to the max (triple tax advantage),
 * (3) Roth IRA to the max,
 * (4) 401(k) to the annual max,
 * (5) taxable brokerage (no limit).
 *
 * NOTE: contribution limits are indexed annually by the IRS. These are the
 * best-known 2026 values — update each year.
 */

// ── 2026 contribution limits ──────────────────────────────────────────────────
/** 401(k)/403(b)/457 employee elective deferral limit (2026). */
export const LIMIT_401K_EMPLOYEE_2026 = 24_500
/** Additional 401(k) catch-up for age 50+ (2026). */
export const LIMIT_401K_CATCHUP_50_2026 = 8_000
/** IRA contribution limit, traditional + Roth combined (2026). */
export const LIMIT_IRA_2026 = 7_500
/** Additional IRA catch-up for age 50+ (2026). */
export const LIMIT_IRA_CATCHUP_50_2026 = 1_100
/** HSA limit, self-only coverage (2026). */
export const LIMIT_HSA_SELF_2026 = 4_400
/** HSA limit, family coverage (2026). */
export const LIMIT_HSA_FAMILY_2026 = 8_750
/** Additional HSA catch-up for age 55+ (2026). */
export const LIMIT_HSA_CATCHUP_55_2026 = 1_000

export type WaterfallStepId =
  | 'k401_match'
  | 'hsa_max'
  | 'roth_ira_max'
  | 'k401_max'
  | 'taxable'

export interface WaterfallStep {
  id: WaterfallStepId
  order: number
  label: string
  /** Annual dollar target for this step (Infinity is never used; taxable has no cap). */
  target: number
  /** Current annual contribution counted toward this step. */
  current: number
  /** Remaining dollars to complete this step. */
  gap: number
  /** Whether this step is fully funded. */
  complete: boolean
  /** Plain-English rationale. */
  why: string
}

export interface WaterfallInput {
  age: number
  /** Gross annual income (used for the employer-match target). */
  income: number
  /** Employer match rate, percent of your contribution (e.g. 50 = 50 cents per dollar). */
  employerMatchPct: number
  /** Employer matches contributions up to this percent of salary (e.g. 6). */
  matchLimitPct: number
  currentContributions: {
    /** Annual employee 401(k) deferral. */
    k401: number
    hsa: number
    /** Annual Roth IRA contribution. */
    rothIra: number
    /** Annual taxable brokerage savings. */
    taxable: number
  }
  /** HSA coverage tier. Default 'self'. */
  hsaCoverage?: 'self' | 'family'
}

export interface WaterfallResult {
  steps: WaterfallStep[]
  /** Sum of all capped-step targets (excludes open-ended taxable). */
  totalTarget: number
  totalCurrent: number
  totalGap: number
  limits: {
    k401: number
    ira: number
    hsa: number
  }
}

export function buildWaterfall(input: WaterfallInput): WaterfallResult {
  const { age, income, employerMatchPct, matchLimitPct, currentContributions } = input
  const c = currentContributions

  const k401Limit =
    LIMIT_401K_EMPLOYEE_2026 + (age >= 50 ? LIMIT_401K_CATCHUP_50_2026 : 0)
  const iraLimit = LIMIT_IRA_2026 + (age >= 50 ? LIMIT_IRA_CATCHUP_50_2026 : 0)
  const hsaBase =
    (input.hsaCoverage ?? 'self') === 'family'
      ? LIMIT_HSA_FAMILY_2026
      : LIMIT_HSA_SELF_2026
  const hsaLimit = hsaBase + (age >= 55 ? LIMIT_HSA_CATCHUP_55_2026 : 0)

  // (1) Defer enough to capture the full employer match.
  const matchTarget = Math.min(
    Math.max(0, income) * Math.max(0, matchLimitPct) / 100,
    k401Limit
  )
  const matchCurrent = Math.min(c.k401, matchTarget)
  const freeMoney = matchTarget * Math.max(0, employerMatchPct) / 100

  const steps: WaterfallStep[] = [
    {
      id: 'k401_match',
      order: 1,
      label: '401(k) to employer match',
      target: round2(matchTarget),
      current: round2(matchCurrent),
      gap: round2(Math.max(0, matchTarget - matchCurrent)),
      complete: matchCurrent >= matchTarget - 0.005,
      why: `Capture the full employer match first — contributing ${matchLimitPct}% of salary earns ~${formatUsd(freeMoney)}/yr in free money, an instant ${employerMatchPct}% return.`,
    },
    {
      id: 'hsa_max',
      order: 2,
      label: 'HSA to max',
      target: hsaLimit,
      current: round2(Math.min(c.hsa, hsaLimit)),
      gap: round2(Math.max(0, hsaLimit - c.hsa)),
      complete: c.hsa >= hsaLimit - 0.005,
      why: `Triple tax advantage: deductible going in, tax-free growth, tax-free out for medical costs.${age >= 55 ? ` Includes the $${LIMIT_HSA_CATCHUP_55_2026.toLocaleString()} age-55+ catch-up.` : ''}`,
    },
    {
      id: 'roth_ira_max',
      order: 3,
      label: 'Roth IRA to max',
      target: iraLimit,
      current: round2(Math.min(c.rothIra, iraLimit)),
      gap: round2(Math.max(0, iraLimit - c.rothIra)),
      complete: c.rothIra >= iraLimit - 0.005,
      why: `Tax-free growth and withdrawals, plus flexible contribution access.${age >= 50 ? ` Includes the $${LIMIT_IRA_CATCHUP_50_2026.toLocaleString()} age-50+ catch-up.` : ''}`,
    },
    {
      id: 'k401_max',
      order: 4,
      label: '401(k) to annual max',
      target: k401Limit,
      current: round2(Math.min(c.k401, k401Limit)),
      gap: round2(Math.max(0, k401Limit - c.k401)),
      complete: c.k401 >= k401Limit - 0.005,
      why: `Tax-deferred space up to $${k401Limit.toLocaleString()}/yr.${age >= 50 ? ` Includes the $${LIMIT_401K_CATCHUP_50_2026.toLocaleString()} age-50+ catch-up.` : ''}`,
    },
    {
      id: 'taxable',
      order: 5,
      label: 'Taxable brokerage',
      target: round2(c.taxable),
      current: round2(c.taxable),
      gap: 0,
      complete: true,
      why: 'No contribution limit — invest any remaining savings here for flexibility and liquidity.',
    },
  ]

  const capped = steps.filter(s => s.id !== 'taxable')
  return {
    steps,
    totalTarget: round2(capped.reduce((s, x) => s + x.target, 0)),
    totalCurrent: round2(capped.reduce((s, x) => s + x.current, 0)),
    totalGap: round2(capped.reduce((s, x) => s + x.gap, 0)),
    limits: { k401: k401Limit, ira: iraLimit, hsa: hsaLimit },
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function formatUsd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}
