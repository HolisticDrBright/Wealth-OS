/**
 * Phase 3 — Simple mode.
 *  - goal projection math (deterministic compounding, status verdicts)
 *  - dollar year-range from rolling 12-month windows (no new risk model)
 *  - weekly plain-English summary: one sentence per action, with reasons,
 *    capped at five, jargon-free
 *  - mode wiring: new users default simple, existing stay pro; the
 *    Command Center stays untouched in pro mode
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  medianOf, projectGoalMonths, addMonths, goalStatusOf,
  rollingYearReturns, yearRangeUsd, badYearSetbackMonths,
} from '@/lib/planning/goal-projection'
import { generateWeeklySummary, MAX_WEEKLY_SENTENCES } from '@/lib/simple/weekly-summary'

// ─── Goal projection ─────────────────────────────────────────────────────────

describe('projectGoalMonths', () => {
  it('already at target → 0 months', () => {
    expect(projectGoalMonths({ currentUsd: 100, monthlyContributionUsd: 0, targetUsd: 100, monthlyReturn: 0 })).toBe(0)
  })

  it('pure contributions, no growth: $500/mo to $6,000 takes 12 months', () => {
    expect(projectGoalMonths({ currentUsd: 0, monthlyContributionUsd: 500, targetUsd: 6000, monthlyReturn: 0 })).toBe(12)
  })

  it('growth shortens the path', () => {
    const flat = projectGoalMonths({ currentUsd: 10_000, monthlyContributionUsd: 500, targetUsd: 80_000, monthlyReturn: 0 })!
    const growing = projectGoalMonths({ currentUsd: 10_000, monthlyContributionUsd: 500, targetUsd: 80_000, monthlyReturn: 0.006 })!
    expect(growing).toBeLessThan(flat)
  })

  it('unreachable (no growth, no contribution) → null', () => {
    expect(projectGoalMonths({ currentUsd: 100, monthlyContributionUsd: 0, targetUsd: 1000, monthlyReturn: 0 })).toBeNull()
  })

  it('goalStatusOf: expected before target = on_track; after = behind; no target date = no_target_date', () => {
    expect(goalStatusOf('2029-05-01', '2029-06-01')).toBe('on_track')
    expect(goalStatusOf('2029-07-01', '2029-06-01')).toBe('behind')
    expect(goalStatusOf('2029-07-01', null)).toBe('no_target_date')
    expect(goalStatusOf(null, '2029-06-01')).toBe('unknown')
  })

  it('addMonths lands on the right month', () => {
    expect(addMonths('2026-11-18T00:00:00Z', 12).slice(0, 7)).toBe('2027-11')
  })
})

// ─── Year range in dollars ───────────────────────────────────────────────────

function syntheticReturns(): number[] {
  // 20 years of alternating months: +2%, -1% → every 12m window ≈ +6.1%
  const out: number[] = []
  for (let i = 0; i < 240; i++) out.push(i % 2 === 0 ? 0.02 : -0.01)
  return out
}

describe('yearRangeUsd', () => {
  it('rolling windows compound correctly', () => {
    const windows = rollingYearReturns(syntheticReturns())
    expect(windows.length).toBe(240 - 12 + 1)
    const expected = Math.pow(1.02 * 0.99, 6) - 1
    expect(windows[0]).toBeCloseTo(expected, 10)
  })

  it('scales percentiles by portfolio value; bad ≤ typical ≤ good', () => {
    const r = yearRangeUsd(100_000, syntheticReturns())!
    expect(r.badYearUsd).toBeLessThanOrEqual(r.typicalYearUsd)
    expect(r.typicalYearUsd).toBeLessThanOrEqual(r.goodYearUsd)
  })

  it('returns null on a too-short series (honest "cannot estimate")', () => {
    expect(yearRangeUsd(100_000, syntheticReturns().slice(0, 30))).toBeNull()
    expect(yearRangeUsd(0, syntheticReturns())).toBeNull()
  })

  it('a bad year pushes the goal back by a positive number of months', () => {
    const median = medianOf(syntheticReturns())!
    const setback = badYearSetbackMonths({
      currentUsd: 40_000, monthlyContributionUsd: 500, targetUsd: 80_000,
      monthlyReturn: median, badYearUsd: -8_000,
    })
    expect(setback).not.toBeNull()
    expect(setback!).toBeGreaterThan(0)
  })
})

// ─── Weekly summary ──────────────────────────────────────────────────────────

describe('generateWeeklySummary', () => {
  it('one sentence per action, each with a reason', () => {
    const items = generateWeeklySummary({
      closes: [{ symbol: 'AAPL', exitReason: 'stop_loss', pnlUsd: -42 }],
      opens: [{ symbol: 'MSFT' }],
      blocked: [{ reason: 'cost gate: expected edge below 2x round-trip cost' }],
      halted: false,
    })
    expect(items.some(s => s.includes('Sold AAPL') && s.includes('$42 loss') && s.includes('loss limit'))).toBe(true)
    expect(items.some(s => s.includes('cost more to place'))).toBe(true)
    expect(items.some(s => s.includes('MSFT'))).toBe(true)
  })

  it('caps at five sentences and leads with a halt', () => {
    const items = generateWeeklySummary({
      closes: Array.from({ length: 6 }, (_, i) => ({ symbol: `S${i}`, exitReason: 'take_profit', pnlUsd: 10 })),
      opens: Array.from({ length: 4 }, (_, i) => ({ symbol: `O${i}` })),
      blocked: [{ reason: 'cost' }, { reason: 'kill switch engaged' }],
      halted: true,
    })
    expect(items.length).toBeLessThanOrEqual(MAX_WEEKLY_SENTENCES)
    expect(items[0]).toContain('paused all trading')
  })

  it('never emits jargon', () => {
    const items = generateWeeklySummary({
      closes: [
        { symbol: 'EUR/USD', exitReason: 'timeout', pnlUsd: 3 },
        { symbol: 'BTC', exitReason: 'manual_flatten', pnlUsd: -7 },
      ],
      opens: [],
      blocked: [{ reason: 'slippage above model' }, { reason: null }],
      halted: false,
    })
    const all = items.join(' ').toLowerCase()
    for (const banned of ['sharpe', 'drawdown', 'notional', 'bps', 'slippage', 'edge']) {
      expect(all).not.toContain(banned)
    }
  })

  it('a quiet week returns an empty list (the UI shows its own quiet copy)', () => {
    expect(generateWeeklySummary({ closes: [], opens: [], blocked: [], halted: false })).toEqual([])
  })
})

// ─── Mode wiring (source contracts) ──────────────────────────────────────────

const read = (p: string) => readFileSync(join(process.cwd(), ...p.split('/')), 'utf8')

describe('simple/pro mode wiring', () => {
  it('unset ui_mode reads as pro, so existing users keep the Command Center', () => {
    const src = read('lib/actions/ui-prefs.ts')
    expect(src).toMatch(/\?\?\s*'pro'/)
  })

  it('the onboarding wizard sets simple mode for new users', () => {
    const src = read('app/onboarding/risk-profile/page.tsx')
    expect(src).toContain("setUiMode('simple')")
  })

  it('pro mode still renders the untouched Command Center', () => {
    const src = read('app/(app)/dashboard/page.tsx')
    expect(src).toContain('SimpleDashboard')
    expect(src).toContain('getCommandCenterData')   // pro path intact
  })

  it('the simple sidebar shows only Home, Goals, Portfolio, Activity, Explore (+Settings)', () => {
    const src = read('components/layout/sidebar.tsx')
    const simple = src.slice(src.indexOf('SIMPLE_NAV'), src.indexOf('const ACTIVE_STYLE'))
    for (const label of ['Home', 'Goals', 'Portfolio', 'Activity', 'Explore']) {
      expect(simple).toContain(`label: '${label}'`)
    }
    expect(simple).not.toContain('Markets')
  })

  it('the risk strip hosts the mode toggle', () => {
    const src = read('components/layout/risk-strip.tsx')
    expect(src).toContain('ModeToggle')
    expect(src).toContain('setUiMode(next)')
  })

  it('simple-mode risk is expressed in dollars, not drawdown percent', () => {
    const src = read('app/(app)/dashboard/simple-dashboard.tsx')
    expect(src).toContain('could fall about')
    const lower = src.toLowerCase()
    for (const banned of ['sharpe', 'drawdown', 'notional', 'bps']) {
      expect(lower).not.toContain(banned)
    }
  })
})
