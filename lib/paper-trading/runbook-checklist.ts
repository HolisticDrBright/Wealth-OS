/**
 * Runbook-as-UI (validation item 13) — docs/paper-trading-validation-runbook.md
 * turned into a practical checklist. Items that CAN be verified from data are
 * auto-computed; everything else is 'manual' and stays visible instead of
 * silently assumed. Keep this file in sync with the runbook document.
 */

import type { PaperScorecard } from './scorecard-core'

export type ChecklistStatus = 'pass' | 'fail' | 'pending' | 'manual'

export interface ChecklistItem {
  id: string
  label: string
  status: ChecklistStatus
  detail: string
}

export interface RunbookChecklist {
  weeklyReview: ChecklistItem[]
  passFail: ChecklistItem[]
  preLive: ChecklistItem[]
  brokerSandbox: ChecklistItem[]
  blockers: string[]
}

export interface ChecklistInputs {
  liveTradingEnabled: boolean
  anyBrokerLiveReady: boolean
  anyLiveCandidateStrategy: boolean
  scorecards: PaperScorecard[]
  lastRunAt: string | null
  ledgerVerified: boolean | null      // null = not checked this session
  deadWorkers: number | null
}

const manual = (id: string, label: string, detail: string): ChecklistItem =>
  ({ id, label, status: 'manual', detail })

export function buildRunbookChecklist(i: ChecklistInputs): RunbookChecklist {
  const reviewReady = i.scorecards.filter(s =>
    s.validationStatus === 'review_ready' || s.validationStatus === 'promotion_ready')
  const promotionReady = i.scorecards.filter(s => s.validationStatus === 'promotion_ready')
  const materialCost = i.scorecards.filter(s => s.materialCostImpact)
  const runFresh = i.lastRunAt != null &&
    Date.now() - new Date(i.lastRunAt).getTime() < 48 * 3_600_000

  const weeklyReview: ChecklistItem[] = [
    {
      id: 'wr-runs',
      label: 'Paper runs executing (last run < 48h old)',
      status: i.lastRunAt == null ? 'fail' : runFresh ? 'pass' : 'fail',
      detail: i.lastRunAt ? `last run ${i.lastRunAt}` : 'no paper runs recorded',
    },
    {
      id: 'wr-scorecards',
      label: 'Record per-strategy metrics in the weekly log',
      status: 'manual',
      detail: 'closed count, win rate, expectancy, avg win/loss, max DD, loss streak, slippage vs model, blocked/veto counts, Brier, shadow comparison',
    },
    {
      id: 'wr-cost',
      label: 'Review strategies where modeled costs materially change expectancy',
      status: materialCost.length === 0 ? 'pass' : 'pending',
      detail: materialCost.length === 0
        ? 'no strategy currently flagged'
        : `${materialCost.length} flagged: ${materialCost.map(s => s.strategyKey).join(', ')}`,
    },
    {
      id: 'wr-ledger',
      label: 'Nightly ledger verification green',
      status: i.ledgerVerified == null ? 'manual' : i.ledgerVerified ? 'pass' : 'fail',
      detail: i.ledgerVerified == null ? 'run the ledger cron task and check its verification result'
        : i.ledgerVerified ? 'chain verifies end-to-end' : 'CHAIN BROKEN — treat as an incident',
    },
    {
      id: 'wr-workers',
      label: 'No silent workers (dead-man switch clear)',
      status: i.deadWorkers == null ? 'manual' : i.deadWorkers === 0 ? 'pass' : 'fail',
      detail: i.deadWorkers == null ? 'check ops-watchdog output'
        : i.deadWorkers === 0 ? 'all heartbeats fresh' : `${i.deadWorkers} worker(s) silent`,
    },
    manual('wr-quarantine', 'Review ingest quarantine count', 'flagged scraped content should be rare; investigate spikes'),
  ]

  const passFail: ChecklistItem[] = [
    {
      id: 'pf-sample',
      label: '≥1 strategy with ≥30 closed paper trades',
      status: reviewReady.length > 0 ? 'pass' : 'pending',
      detail: reviewReady.length > 0
        ? `${reviewReady.length} strategy(ies) review-ready: ${reviewReady.map(s => s.strategyKey).join(', ')}`
        : `best so far: ${Math.max(0, ...i.scorecards.map(s => s.closedTrades))} closed trades`,
    },
    {
      id: 'pf-gates',
      label: '≥1 strategy passes EVERY promotion gate (expectancy, Brier, drawdown, shadow)',
      status: promotionReady.length > 0 ? 'pass' : 'pending',
      detail: promotionReady.length > 0
        ? promotionReady.map(s => s.strategyKey).join(', ')
        : 'no strategy passes all gates yet',
    },
    manual('pf-benchmark', 'No strategy trailing its passive benchmark 2 consecutive quarters',
      'weekly lifecycle cron demotes automatically; confirm no demotions were suppressed'),
    manual('pf-drills', 'Kill switch, sleeve halts, and TIPP floors each fired correctly at least once',
      'naturally or via drill — record the evidence'),
  ]

  const preLive: ChecklistItem[] = [
    {
      id: 'pl-disabled',
      label: 'LIVE_TRADING_ENABLED stays unset during the phase',
      status: i.liveTradingEnabled ? 'fail' : 'pass',
      detail: i.liveTradingEnabled
        ? 'MASTER SWITCH IS ON — this violates the validation protocol'
        : 'master switch off — paper phase intact',
    },
    {
      id: 'pl-noready',
      label: 'No broker adapter is liveReady before sandbox verification',
      status: i.anyBrokerLiveReady ? 'fail' : 'pass',
      detail: i.anyBrokerLiveReady
        ? 'an adapter is marked liveReady without recorded sandbox evidence'
        : 'all adapters liveReady:false',
    },
    {
      id: 'pl-nocandidate',
      label: 'No strategy is live_candidate until it passes every gate (reviewed PR)',
      status: i.anyLiveCandidateStrategy
        ? (promotionReady.length > 0 ? 'manual' : 'fail')
        : 'pass',
      detail: i.anyLiveCandidateStrategy
        ? 'a live_candidate exists — verify it earned promotion through the gates'
        : 'registry has no live_candidate strategies',
    },
    manual('pl-2months', 'Two full months of paper validation with weekly logs', 'calendar evidence, not vibes'),
    manual('pl-risk', 'Risk parameters reviewed (drawdown limit, daily loss, sleeve caps, floors, size caps)', 'sign-off recorded'),
    manual('pl-cap', 'First live week uses a small hard notional cap', 'set before flipping the switch'),
  ]

  const brokerSandbox: ChecklistItem[] = [
    manual('bs-orders', 'Order placement verified against the broker sandbox', 'Alpaca paper API / OANDA fxpractice / Coinbase sandbox'),
    manual('bs-cancel', 'Cancellation + order status verified against the sandbox', 'including bracket legs'),
    manual('bs-sizing', 'Notional/quantity sizing verified for the exact instruments to be traded', 'the unsafe conversions were removed — adapters need explicit quantities'),
    manual('bs-reconcile', 'OCO reconciler + position monitor proven against sandbox fills', 'run the reconciler against real sandbox state'),
    manual('bs-flip', 'Only then: liveReady:true for THAT adapter only, in a reviewed PR', 'never flip liveReady in config or by hand'),
  ]

  const blockers: string[] = []
  if (i.liveTradingEnabled) blockers.push('LIVE_TRADING_ENABLED is set — must stay off during validation')
  if (i.anyBrokerLiveReady) blockers.push('A broker adapter is liveReady without sandbox evidence')
  if (i.lastRunAt == null) blockers.push('No paper runs recorded — the validation clock has not started')
  else if (!runFresh) blockers.push('Paper runs are stale (>48h) — scheduled scans may be broken')
  if (reviewReady.length === 0) blockers.push('No strategy has reached 30 closed trades yet')
  if (i.deadWorkers != null && i.deadWorkers > 0) blockers.push(`${i.deadWorkers} worker(s) silent — investigate before trusting run data`)

  return { weeklyReview, passFail, preLive, brokerSandbox, blockers }
}
