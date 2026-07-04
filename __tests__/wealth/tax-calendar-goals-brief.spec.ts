/**
 * Item 4 — tax calendar generation (dates, needs_data labels, seeded
 * constants only). Item 6 — goal progress math. Item 10 — brief states.
 * Plus the no-loophole sweep over all user-facing outputs.
 */

import { describe, it, expect } from 'vitest'
import { generateTaxCalendar, type TaxCalendarInputs } from '@/lib/advisory/tax-calendar'
import { summarizeGoalProgress, summarizeGoals, type HouseholdGoal } from '@/lib/advisory/goals'
import { composeBrief, type BriefInputs } from '@/lib/advisory/brief'

// ─── tax calendar ─────────────────────────────────────────────────────────────

const CONSTANTS = {
  ira_limit: 7500, hsa_limit_single: 4400, hsa_limit_family: 8750, solo401k_employee: 24500,
}

function calInputs(over: Partial<TaxCalendarInputs> = {}): TaxCalendarInputs {
  return {
    today: new Date('2026-02-01T12:00:00Z'),
    constants: CONSTANTS,
    ageSelf: 40, isBusinessOwner: false, onHdhp: true,
    ytdIraContributionUsd: 1_000, ytdHsaContributionUsd: 0, ytd401kEmployeeUsd: 5_000,
    filingStatus: 'single',
    washSaleWindows: [], harvestCandidates: 0,
    ...over,
  }
}

describe('generateTaxCalendar (item 4)', () => {
  it('IRA/HSA deadline is Apr 15 of the CURRENT year when today is before it', () => {
    const entries = generateTaxCalendar(calInputs())
    expect(entries.find(e => e.id === 'ira_deadline')?.date).toBe('2026-04-15')
    expect(entries.find(e => e.id === 'hsa_deadline')?.date).toBe('2026-04-15')
  })

  it('…and rolls to NEXT year after Apr 15', () => {
    const entries = generateTaxCalendar(calInputs({ today: new Date('2026-06-01T12:00:00Z') }))
    expect(entries.find(e => e.id === 'ira_deadline')?.date).toBe('2027-04-15')
  })

  it('limits come from seeded constants, never hardcoded', () => {
    const withConstants = generateTaxCalendar(calInputs())
    expect(withConstants.find(e => e.id === 'ira_deadline')?.detail).toContain('$7,500')
    const without = generateTaxCalendar(calInputs({ constants: null }))
    expect(without.find(e => e.id === 'ira_deadline')?.detail).toContain('limit unavailable')
  })

  it('missing inputs produce needs_data labels, not guesses', () => {
    const entries = generateTaxCalendar(calInputs({
      ageSelf: null, onHdhp: null, isBusinessOwner: null, ytdIraContributionUsd: null,
    }))
    expect(entries.find(e => e.id === 'rmd')?.status).toBe('needs_data')
    expect(entries.find(e => e.id === 'rmd')?.missingInputs).toContain('age')
    expect(entries.find(e => e.id === 'hsa_deadline')?.status).toBe('needs_data')
    expect(entries.find(e => e.id === 'ira_deadline')?.status).toBe('needs_data')
  })

  it('RMD appears as a real deadline at age ≥73 and not at all at 40', () => {
    const young = generateTaxCalendar(calInputs({ ageSelf: 40 }))
    expect(young.find(e => e.id === 'rmd')).toBeUndefined()
    const rmdAge = generateTaxCalendar(calInputs({ ageSelf: 75 }))
    const rmd = rmdAge.find(e => e.id === 'rmd')
    expect(rmd?.status).not.toBe('needs_data')
    expect(rmd?.detail).toContain('25% excise')
  })

  it('wash-sale windows and estimated-tax quarters appear with correct dates', () => {
    const entries = generateTaxCalendar(calInputs({
      isBusinessOwner: true,
      washSaleWindows: [{ symbol: 'NVDA', blockedUntil: '2026-02-20T00:00:00Z' }],
    }))
    expect(entries.find(e => e.id === 'wash_NVDA')?.date).toBe('2026-02-20')
    expect(entries.filter(e => e.id.startsWith('est_tax')).map(e => e.date))
      .toEqual(['2026-04-15', '2026-06-15', '2026-09-15', '2027-01-15'])
    // Within 30 days of 2026-02-01 → wash-sale entry is 'soon'.
    expect(entries.find(e => e.id === 'wash_NVDA')?.status).toBe('soon')
  })

  it('entries are chronologically sorted', () => {
    const entries = generateTaxCalendar(calInputs())
    const dates = entries.map(e => e.date)
    expect(dates).toEqual([...dates].sort())
  })
})

// ─── goals ────────────────────────────────────────────────────────────────────

function goal(over: Partial<HouseholdGoal> = {}): HouseholdGoal {
  return {
    id: 'g1', name: 'House', goalType: 'home', targetAmountUsd: 100_000,
    currentAmountUsd: 40_000, targetDate: '2028-07-01',
    monthlyContributionUsd: 2_000, status: 'active', notes: null,
    ...over,
  }
}

describe('goal progress (item 6)', () => {
  const now = new Date('2026-07-01T00:00:00Z')

  it('straight-line progress, required monthly, on-track verdict', () => {
    const p = summarizeGoalProgress(goal(), now)
    expect(p.progressPct).toBe(40)
    expect(p.remainingUsd).toBe(60_000)
    expect(p.monthsRemaining).toBe(24)
    expect(p.requiredMonthlyUsd).toBe(2_500)
    expect(p.onTrack).toBe(false)   // contributing 2000 < 2500 needed
    expect(p.detail).toContain('straight-line')
  })

  it('missing target date or contribution → missing inputs, never a guess', () => {
    const p = summarizeGoalProgress(goal({ targetDate: null }), now)
    expect(p.missingInputs).toContain('target date')
    expect(p.onTrack).toBeNull()

    const q = summarizeGoalProgress(goal({ monthlyContributionUsd: null }), now)
    expect(q.missingInputs).toContain('monthly contribution')
    expect(q.onTrack).toBeNull()
  })

  it('placeholder goal types are review reminders, not funded targets', () => {
    const p = summarizeGoalProgress(goal({ goalType: 'insurance_review' }), now)
    expect(p.isPlaceholder).toBe(true)
    expect(p.progressPct).toBeNull()
    expect(p.detail).toContain('Review reminder')
  })

  it('summary counts + missing core categories + labeled assumptions', () => {
    const s = summarizeGoals([
      goal(),
      goal({ id: 'g2', goalType: 'retirement', monthlyContributionUsd: 5_000, targetDate: '2050-01-01' }),
    ], now)
    expect(s.activeCount).toBe(2)
    expect(s.onTrackCount).toBe(1)
    expect(s.offTrackCount).toBe(1)
    expect(s.missingCategories).toContain('emergency')
    expect(s.assumptionsNote).toContain('no investment growth')
  })
})

// ─── brief ────────────────────────────────────────────────────────────────────

function briefInputs(over: Partial<BriefInputs> = {}): BriefInputs {
  return {
    checkupItems: [], bestNext: null, calendar: [], runbookBlockers: [],
    staleWarnings: [], killSwitchActive: false, deadWorkers: 0,
    paper: { lastRunAt: '2026-07-04T09:00:00Z', reviewReady: 1, openPositions: 3, tracked: 12 },
    now: new Date('2026-07-04T12:00:00Z'),
    ...over,
  }
}

describe('composeBrief (item 10)', () => {
  it('empty inputs → honest nothing-urgent state with paper status', () => {
    const b = composeBrief(briefInputs())
    expect(b.nothingUrgent).toBe(true)
    expect(b.urgent).toHaveLength(0)
    expect(b.paperStatus).toContain('Live trading remains disabled')
  })

  it('kill switch + close deadline + wash-sale action → urgent state', () => {
    const b = composeBrief(briefInputs({
      killSwitchActive: true,
      calendar: [{
        id: 'ira_deadline', date: '2026-07-10', title: 'IRA contribution deadline',
        category: 'contribution', detail: 'd', status: 'soon', daysAway: 6, missingInputs: [],
      }],
      checkupItems: [{ id: 'wash_sale', title: 'Wash-sale windows', status: 'action', summary: 's' }],
    }))
    expect(b.nothingUrgent).toBe(false)
    expect(b.riskAlerts.some(r => r.includes('kill switch'))).toBe(true)
    expect(b.urgent.some(u => u.id === 'cal_ira_deadline')).toBe(true)
    expect(b.urgent.some(u => u.id === 'checkup_wash_sale')).toBe(true)
  })

  it('normal state: money moves listed, nothing urgent flagged false only when warranted', () => {
    const b = composeBrief(briefInputs({
      bestNext: { title: 'Employer 401(k) match', reason: 'guaranteed return' },
      checkupItems: [{ id: 'rebalance', title: 'Rebalancing', status: 'action', summary: '2 pending' }],
    }))
    expect(b.nothingUrgent).toBe(true)   // actions are considerations, not emergencies
    expect(b.moneyMoves[0].title).toContain('Best next dollar')
    expect(b.moneyMoves.some(m => m.id === 'checkup_rebalance')).toBe(true)
  })
})

// ─── language sweep ───────────────────────────────────────────────────────────

describe('no-loophole language (hard constraint)', () => {
  it('calendar, goals, and brief outputs never use prohibited language', () => {
    const calendar = generateTaxCalendar(calInputs({ isBusinessOwner: true, ageSelf: 75 }))
    const goals = summarizeGoals([goal(), goal({ id: 'g2', goalType: 'insurance_review' })])
    const brief = composeBrief(briefInputs({
      bestNext: { title: 'Backdoor Roth IRA', reason: 'over the MAGI limit' },
    }))
    const text = JSON.stringify({ calendar, goals, brief }).toLowerCase()
    expect(text).not.toContain('loophole')
    expect(text).not.toContain('guaranteed profit')
    expect(text).not.toContain('risk-free investment')
  })
})
