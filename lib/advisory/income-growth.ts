/**
 * Income-Growth pure helpers (P3) — trigger logic, the income-vs-allocation
 * Monte Carlo comparison, and the coaching idea generator.
 *
 * Lives OUTSIDE lib/advisory/rules/ so month/slice constants aren't subject to
 * the rules-only no-magic-numbers guard (those thresholds that MUST come from
 * kb_parameters are still passed in — never hardcoded). Imports only the pure
 * planning Monte Carlo; nothing in the execution path.
 */

import { planningRecommendationDelta, type PlanningInput } from '@/lib/planning/monte-carlo'
import type { FinancialProfile } from './types'

const MONTHS_PER_YEAR = 12
const MAX_SKILLS_SHOWN = 3

// ─── Trigger (pure, both directions) ─────────────────────────────────────────

export interface IncomeGrowthTriggerInput {
  investableUsd: number | null
  massAffluentThresholdUsd: number
  annualIncomeUsd: number | null
  annualSavingsUsd: number | null
  minSavingsRate: number
  /** True when tax-advantaged waterfall steps (match/HSA/IRA/401k) are unfilled. */
  waterfallUnfilled: boolean
}

export function incomeGrowthTriggered(i: IncomeGrowthTriggerInput): { triggered: boolean; reason: string } {
  if (i.investableUsd != null && i.investableUsd < i.massAffluentThresholdUsd) {
    return {
      triggered: true,
      reason: 'Investable assets are below the mass-affluent threshold — at this level income growth has more leverage than any allocation change.',
    }
  }
  if (i.annualIncomeUsd != null && i.annualIncomeUsd > 0 && i.annualSavingsUsd != null) {
    const rate = i.annualSavingsUsd / i.annualIncomeUsd
    if (rate < i.minSavingsRate && i.waterfallUnfilled) {
      return {
        triggered: true,
        reason: `Savings rate ${Math.round(rate * 100)}% is below ${Math.round(i.minSavingsRate * 100)}% with tax-advantaged room still open — income growth outranks allocation here.`,
      }
    }
  }
  return { triggered: false, reason: 'Allocation optimization can still move the needle at this level.' }
}

// ─── Income-vs-allocation comparison (QUANTIFIED — real Monte Carlo) ──────────

export interface IncomeVsAllocation {
  incomeMonthlyDeltaUsd: number
  incomeDeltaPct: number
  allocationDeltaPct: number
  incomeWins: boolean
  headline: string
}

export function compareIncomeVsAllocation(
  base: PlanningInput,
  incomeMonthlyDeltaUsd: number,
  savingsRate: number,
  bestAllocationBenefitUsd: number
): IncomeVsAllocation {
  const rate = Math.max(0, Math.min(1, savingsRate))
  const incomeToSavingsAnnual = incomeMonthlyDeltaUsd * MONTHS_PER_YEAR * rate
  const income = planningRecommendationDelta(base, incomeToSavingsAnnual)
  const allocation = planningRecommendationDelta(base, Math.max(0, bestAllocationBenefitUsd))
  // Strictly greater — a tie goes to the allocation lever (never overclaim income).
  const incomeWins = income.deltaPct > allocation.deltaPct
  const per = `$${Math.round(incomeMonthlyDeltaUsd).toLocaleString()}/mo`
  const headline = incomeWins
    ? `At your savings rate, +${per} of income raises your goal probability by ${income.deltaPct} pts — more than the best allocation change we can make (${allocation.deltaPct} pts).`
    : `An allocation change still leads here (${allocation.deltaPct} pts vs ${income.deltaPct} pts from +${per} income).`
  return { incomeMonthlyDeltaUsd, incomeDeltaPct: income.deltaPct, allocationDeltaPct: allocation.deltaPct, incomeWins, headline }
}

// ─── Coaching idea cards ─────────────────────────────────────────────────────

export type IdeaEase = 'easy' | 'moderate' | 'hard'
export type IdeaSpeed = 'fast' | 'medium' | 'slow'
export type IdeaInvestment = 'none' | 'low' | 'high'
export type IdeaPotential = 'low' | 'medium' | 'high'
export type IdeaScalability = 'linear' | 'scalable'

export interface IncomeIdea {
  category: 'rate_raise' | 'skills_to_income' | 'extra_income_source' | 'digital_asset'
  title: string
  description: string
  ease: IdeaEase
  speed: IdeaSpeed
  requiredInvestment: IdeaInvestment
  profitPotential: IdeaPotential
  scalability: IdeaScalability
}

export function generateIncomeIdeas(profile: FinancialProfile): IncomeIdea[] {
  const ctx = profile.income_context ?? null
  const occ = ctx?.occupation ? ` for a ${ctx.occupation}` : ''
  const skills = ctx?.skills?.length ? ` (${ctx.skills.slice(0, MAX_SKILLS_SHOWN).join(', ')})` : ''
  return [
    {
      category: 'rate_raise',
      title: 'Raise your rate / renegotiate',
      description: `The fastest income lever${occ} is charging or earning more for work you already do — a rate increase, a raise conversation, or repricing existing clients.`,
      ease: 'moderate', speed: 'fast', requiredInvestment: 'none', profitPotential: 'medium', scalability: 'linear',
    },
    {
      category: 'skills_to_income',
      title: 'Map your skills to paid work',
      description: `Turn existing skills${skills} into billable services or consulting — the shortest path from capability to cash.`,
      ease: 'moderate', speed: 'medium', requiredInvestment: 'low', profitPotential: 'medium', scalability: 'linear',
    },
    {
      category: 'extra_income_source',
      title: 'Add a second income source',
      description: 'A part-time or project-based income stream sized to the hours you actually have — additive, not a career change.',
      ease: 'easy', speed: 'medium', requiredInvestment: 'low', profitPotential: 'medium', scalability: 'linear',
    },
    {
      category: 'digital_asset',
      title: 'Build a digital asset',
      description: 'A product that earns after it is built (course, template, tool). Slower and less certain, but the only scalable option on this list.',
      ease: 'hard', speed: 'slow', requiredInvestment: 'low', profitPotential: 'high', scalability: 'scalable',
    },
  ]
}
