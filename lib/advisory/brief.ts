/**
 * Daily/weekly wealth brief (upgrade item 10) — pure composer. Turns the
 * checkup, calendar, paper-validation state, and staleness signals into a
 * short practical brief with an honest "nothing urgent" state. Never sends
 * notifications; it only renders.
 */

import type { CalendarEntry } from './tax-calendar'

export interface BriefItem {
  id: string
  title: string
  detail: string
  severity: 'urgent' | 'normal' | 'info'
}

export interface WealthBrief {
  urgent: BriefItem[]
  moneyMoves: BriefItem[]
  deadlines: BriefItem[]
  staleData: string[]
  riskAlerts: string[]
  paperStatus: string
  nothingUrgent: boolean
  generatedAt: string
}

export interface BriefInputs {
  checkupItems: Array<{ id: string; title: string; status: string; summary: string }>
  bestNext: { title: string; reason: string } | null
  calendar: CalendarEntry[]
  runbookBlockers: string[]
  staleWarnings: string[]
  killSwitchActive: boolean
  deadWorkers: number | null
  paper: { lastRunAt: string | null; reviewReady: number; openPositions: number; tracked: number }
  now?: Date
}

const URGENT_DEADLINE_DAYS = 14

export function composeBrief(i: BriefInputs): WealthBrief {
  const urgent: BriefItem[] = []
  const moneyMoves: BriefItem[] = []
  const deadlines: BriefItem[] = []
  const riskAlerts: string[] = []

  // ── risk/safety first ───────────────────────────────────────────────────────
  if (i.killSwitchActive) {
    riskAlerts.push('Trading kill switch is ACTIVE — all order paths are halted until cleared.')
  }
  if (i.deadWorkers != null && i.deadWorkers > 0) {
    riskAlerts.push(`${i.deadWorkers} background worker(s) silent — run data may be incomplete.`)
  }
  for (const b of i.runbookBlockers) {
    if (b.includes('LIVE_TRADING_ENABLED') || b.includes('liveReady')) {
      riskAlerts.push(b)   // protocol violations are risk alerts, not chores
    }
  }

  // ── deadlines inside the urgent window ──────────────────────────────────────
  for (const e of i.calendar) {
    if (e.status === 'soon' && e.daysAway != null) {
      const item: BriefItem = {
        id: `cal_${e.id}`,
        title: `${e.title} — ${e.daysAway} day(s)`,
        detail: e.detail,
        severity: e.daysAway <= URGENT_DEADLINE_DAYS ? 'urgent' : 'normal',
      }
      if (item.severity === 'urgent') urgent.push(item)
      else deadlines.push(item)
    }
  }

  // ── money moves from the checkup ────────────────────────────────────────────
  if (i.bestNext) {
    moneyMoves.push({
      id: 'best_next',
      title: `Best next dollar: ${i.bestNext.title}`,
      detail: i.bestNext.reason,
      severity: 'normal',
    })
  }
  for (const item of i.checkupItems.filter(c => c.status === 'action').slice(0, 4)) {
    // Wash-sale windows are time-critical; other actions are considerations.
    const isUrgent = item.id === 'wash_sale'
    const brief: BriefItem = {
      id: `checkup_${item.id}`, title: item.title, detail: item.summary,
      severity: isUrgent ? 'urgent' : 'normal',
    }
    if (isUrgent) urgent.push(brief)
    else moneyMoves.push(brief)
  }

  // ── paper validation status ─────────────────────────────────────────────────
  const runNote = i.paper.lastRunAt == null
    ? 'no paper runs recorded yet — the validation clock has not started'
    : `last run ${i.paper.lastRunAt.slice(0, 16).replace('T', ' ')}`
  const paperStatus =
    `${i.paper.tracked} strategies tracked · ${i.paper.reviewReady} review-ready · ` +
    `${i.paper.openPositions} open paper positions · ${runNote}. Live trading remains disabled.`

  const nothingUrgent = urgent.length === 0 && riskAlerts.length === 0

  return {
    urgent,
    moneyMoves,
    deadlines,
    staleData: i.staleWarnings,
    riskAlerts,
    paperStatus,
    nothingUrgent,
    generatedAt: (i.now ?? new Date()).toISOString(),
  }
}
