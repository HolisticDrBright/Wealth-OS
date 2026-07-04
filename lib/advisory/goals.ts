/**
 * Household goal summaries (upgrade item 6) — pure, simple, explainable.
 *
 * ASSUMPTIONS (labeled, never hidden): progress is linear, no growth is
 * assumed on contributions, and required-monthly is a straight division of
 * the remaining gap over the remaining months. Real plans need Monte Carlo
 * (the planning module has one) — this is the honest quick view.
 */

import { panelQualityOf, type PanelQuality } from '@/lib/advisory/data-quality'

export const GOAL_TYPES = [
  'retirement', 'home', 'education', 'emergency', 'major_purchase', 'business',
  'insurance_review', 'estate', 'charitable', 'trust', 'other', 'general',
] as const
export type GoalType = (typeof GOAL_TYPES)[number]

/** Placeholder goal types: tracked as reminders, not funded targets. */
export const PLACEHOLDER_GOAL_TYPES: GoalType[] = ['insurance_review', 'estate', 'charitable']

export interface HouseholdGoal {
  id: string
  name: string
  goalType: GoalType
  targetAmountUsd: number
  currentAmountUsd: number
  targetDate: string | null
  monthlyContributionUsd: number | null
  status: string
  notes: string | null
}

export interface GoalProgress {
  id: string
  name: string
  goalType: GoalType
  isPlaceholder: boolean
  progressPct: number | null
  remainingUsd: number | null
  monthsRemaining: number | null
  /** Straight-line required monthly (no growth assumed) — labeled assumption. */
  requiredMonthlyUsd: number | null
  onTrack: boolean | null
  missingInputs: string[]
  detail: string
}

export interface GoalsSummary {
  goals: GoalProgress[]
  activeCount: number
  onTrackCount: number
  offTrackCount: number
  needsDataCount: number
  /** Goal categories the household has not set up at all. */
  missingCategories: GoalType[]
  quality: PanelQuality
  assumptionsNote: string
}

export const GOALS_ASSUMPTIONS_NOTE =
  'Straight-line math: no investment growth assumed on contributions, no inflation adjustment. ' +
  'Conservative by design — the planning module runs the full Monte Carlo.'

export function summarizeGoalProgress(g: HouseholdGoal, now = new Date()): GoalProgress {
  const isPlaceholder = PLACEHOLDER_GOAL_TYPES.includes(g.goalType)
  const missingInputs: string[] = []

  if (isPlaceholder) {
    return {
      id: g.id, name: g.name, goalType: g.goalType, isPlaceholder: true,
      progressPct: null, remainingUsd: null, monthsRemaining: null,
      requiredMonthlyUsd: null, onTrack: null, missingInputs: [],
      detail: 'Review reminder — not a funded target. Schedule the review and record the outcome in notes.',
    }
  }

  if (!(g.targetAmountUsd > 0)) missingInputs.push('target amount')
  if (g.targetDate == null) missingInputs.push('target date')

  const progressPct = g.targetAmountUsd > 0
    ? Math.min(100, Math.round((g.currentAmountUsd / g.targetAmountUsd) * 1000) / 10)
    : null
  const remainingUsd = g.targetAmountUsd > 0
    ? Math.max(0, g.targetAmountUsd - g.currentAmountUsd)
    : null

  let monthsRemaining: number | null = null
  let requiredMonthlyUsd: number | null = null
  let onTrack: boolean | null = null
  if (g.targetDate != null && remainingUsd != null) {
    monthsRemaining = Math.max(0, Math.round(
      (new Date(g.targetDate).getTime() - now.getTime()) / (30.44 * 86_400_000)))
    requiredMonthlyUsd = monthsRemaining > 0
      ? Math.round(remainingUsd / monthsRemaining)
      : remainingUsd > 0 ? remainingUsd : 0
    if (g.monthlyContributionUsd != null) {
      onTrack = remainingUsd === 0 || g.monthlyContributionUsd >= (requiredMonthlyUsd ?? 0)
    } else if (remainingUsd === 0) {
      onTrack = true
    } else {
      missingInputs.push('monthly contribution')
    }
  }

  const detail = missingInputs.length > 0
    ? `Add ${missingInputs.join(' and ')} to compute progress.`
    : remainingUsd === 0
      ? 'Fully funded.'
      : `$${Math.round(remainingUsd ?? 0).toLocaleString()} to go over ~${monthsRemaining} month(s) → ~$${(requiredMonthlyUsd ?? 0).toLocaleString()}/mo needed (straight-line).`

  return {
    id: g.id, name: g.name, goalType: g.goalType, isPlaceholder: false,
    progressPct, remainingUsd, monthsRemaining, requiredMonthlyUsd, onTrack,
    missingInputs, detail,
  }
}

export function summarizeGoals(goals: HouseholdGoal[], now = new Date()): GoalsSummary {
  const active = goals.filter(g => g.status === 'active')
  const progress = active.map(g => summarizeGoalProgress(g, now))
  const funded = progress.filter(p => !p.isPlaceholder)

  const CORE_CATEGORIES: GoalType[] = ['retirement', 'emergency', 'home', 'education']
  const presentTypes = new Set(active.map(g => g.goalType))
  const missingCategories = CORE_CATEGORIES.filter(t => !presentTypes.has(t))

  const lastUpdated = null   // goal rows carry updated_at; loader may pass through
  return {
    goals: progress,
    activeCount: active.length,
    onTrackCount: funded.filter(p => p.onTrack === true).length,
    offTrackCount: funded.filter(p => p.onTrack === false).length,
    needsDataCount: progress.filter(p => p.missingInputs.length > 0).length,
    missingCategories,
    quality: panelQualityOf({
      presentCount: active.length,
      requiredMissing: [],
      optionalMissing: missingCategories.map(c => `${c} goal`),
      source: active.length === 0 ? 'none' : 'manual',
      lastUpdated,
    }),
    assumptionsNote: GOALS_ASSUMPTIONS_NOTE,
  }
}
