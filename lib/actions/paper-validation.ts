'use server'

/**
 * Paper Trading Validation Dashboard — single data loader. Assembles the
 * operator view: safety-gate status, run health, positions, scorecards,
 * coverage, synergy, and the runbook checklist. Fully serializable; the
 * page renders it without further fetching.
 */

import { createClient } from '@/lib/supabase/server'
import { liveTradingEnabled } from '@/lib/broker-adapters/execution-guard'
import { BROKER_ADAPTERS } from '@/lib/broker-adapters/router'
import { KalshiAdapter } from '@/lib/integrations/kalshi/KalshiAdapter'
import { FILL_MODEL, type FillModelParams } from '@/lib/paper-trading/fill-model'
import { loadScorecardsForUser } from '@/lib/actions/paper-scorecard'
import type { PaperScorecard } from '@/lib/paper-trading/scorecard-core'
import { buildCoverageReport, type StrategyCoverageReport } from '@/lib/paper-trading/strategy-coverage'
import { buildSynergyReport, type SynergyReport } from '@/lib/paper-trading/synergy'
import { buildRunbookChecklist, type RunbookChecklist } from '@/lib/paper-trading/runbook-checklist'
import { buildReadinessMatrix, type BrokerReadinessRow, type CertificationRow } from '@/lib/paper-trading/broker-certification'
import { findDeadWorkers } from '@/lib/ops/reconcile'
import { STRATEGY_REGISTRY_CONFIG } from '@/lib/strategies/strategy-registry'

export interface BrokerStatusRow {
  id: string
  displayName: string
  configured: boolean
  liveReady: boolean
}

export interface SafetyStatus {
  liveTradingEnabled: boolean
  masterSwitchEnvSet: boolean
  brokers: BrokerStatusRow[]
  liveReadyCount: number
  liveCandidateStrategies: string[]
}

export interface OpenPositionView {
  strategyKey: string
  symbol: string
  assetClass: string
  direction: string
  entryPrice: number
  currentPrice: number | null
  notionalUsd: number
  unrealizedPnlUsd: number | null
  openedAt: string
}

export interface ClosedPositionView {
  strategyKey: string
  symbol: string
  direction: string
  realizedPnlUsd: number | null
  realizedPnlPct: number | null
  exitReason: string | null
  closedAt: string
}

export interface RunView {
  runAt: string
  strategiesRun: number
  opportunitiesFound: number
  positionsOpened: number
  positionsClosed: number
  errors: number
  regime: string | null
}

export interface PaperValidationData {
  safety: SafetyStatus
  /** Sandbox certification matrix (item 5) — NEVER flips liveReady. */
  brokerReadiness: BrokerReadinessRow[]
  runs: RunView[]
  lastRunAt: string | null
  openPositions: OpenPositionView[]
  recentClosed: ClosedPositionView[]
  scorecards: PaperScorecard[]
  coverage: StrategyCoverageReport
  synergy: SynergyReport
  checklist: RunbookChecklist
  fillModel: Record<string, FillModelParams>
  deadWorkers: number | null
  error?: string
}

function emptyData(error?: string): PaperValidationData {
  const safety = buildSafetyStatus()
  return {
    safety,
    brokerReadiness: buildReadinessMatrix(
      safety.brokers.map(b => ({ id: b.id, displayName: b.displayName, configured: b.configured, liveReady: b.liveReady })),
      []
    ),
    runs: [],
    lastRunAt: null,
    openPositions: [],
    recentClosed: [],
    scorecards: [],
    coverage: buildCoverageReport([]),
    synergy: buildSynergyReport({ openPositions: [], closedPositions: [], regime: null }),
    checklist: buildRunbookChecklist({
      liveTradingEnabled: safety.liveTradingEnabled,
      anyBrokerLiveReady: safety.liveReadyCount > 0,
      anyLiveCandidateStrategy: safety.liveCandidateStrategies.length > 0,
      scorecards: [],
      lastRunAt: null,
      ledgerVerified: null,
      deadWorkers: null,
    }),
    fillModel: FILL_MODEL,
    deadWorkers: null,
    error,
  }
}

function buildSafetyStatus(): SafetyStatus {
  const adapters = [...BROKER_ADAPTERS, new KalshiAdapter()]
  const brokers: BrokerStatusRow[] = adapters.map(a => ({
    id: a.config.id,
    displayName: a.config.displayName,
    configured: a.isConfigured(),
    liveReady: a.config.capabilities.liveReady,
  }))
  const liveCandidateStrategies = Object.entries(STRATEGY_REGISTRY_CONFIG)
    .filter(([, cfg]) => cfg.maturityStatus === 'live_candidate')
    .map(([key]) => key)
  return {
    liveTradingEnabled: liveTradingEnabled(),
    masterSwitchEnvSet: process.env.LIVE_TRADING_ENABLED != null,
    brokers,
    liveReadyCount: brokers.filter(b => b.liveReady).length,
    liveCandidateStrategies,
  }
}

export async function getPaperValidationData(): Promise<PaperValidationData> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return emptyData('not signed in')

  try {
    const [scorecards, runsRes, openRes, closedRes, regimeRes, beatsRes, certsRes] = await Promise.all([
      loadScorecardsForUser(supabase, user.id),
      supabase
        .from('paper_trade_runs')
        .select('run_at, strategies_run, opportunities_found, positions_opened, positions_closed, errors, regime')
        .eq('user_id', user.id)
        .order('run_at', { ascending: false })
        .limit(12),
      supabase
        .from('paper_positions')
        .select('strategy_key, symbol, asset_class, direction, entry_price, current_price, notional_usd, unrealized_pnl_usd, opened_at')
        .eq('user_id', user.id)
        .eq('status', 'open')
        .order('opened_at', { ascending: false })
        .limit(50),
      supabase
        .from('paper_positions')
        .select('strategy_key, symbol, direction, realized_pnl_usd, realized_pnl_pct, exit_reason, closed_at')
        .eq('user_id', user.id)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .limit(25),
      supabase
        .from('regime_state')
        .select('regime')
        .order('as_of', { ascending: false })
        .limit(1),
      supabase
        .from('worker_heartbeats')
        .select('worker, last_seen'),
      supabase
        .from('broker_certifications')
        .select('*')
        .then(r => (r.data ?? []) as CertificationRow[], () => [] as CertificationRow[]),
    ])

    const runs: RunView[] = ((runsRes.data ?? []) as Array<Record<string, unknown>>).map(r => ({
      runAt: String(r.run_at),
      strategiesRun: Number(r.strategies_run ?? 0),
      opportunitiesFound: Number(r.opportunities_found ?? 0),
      positionsOpened: Number(r.positions_opened ?? 0),
      positionsClosed: Number(r.positions_closed ?? 0),
      errors: Array.isArray(r.errors) ? r.errors.length : 0,
      regime: (r.regime as string | null) ?? null,
    }))

    const openPositions: OpenPositionView[] = ((openRes.data ?? []) as Array<Record<string, unknown>>).map(p => ({
      strategyKey: String(p.strategy_key),
      symbol: String(p.symbol),
      assetClass: String(p.asset_class),
      direction: String(p.direction),
      entryPrice: Number(p.entry_price),
      currentPrice: p.current_price != null ? Number(p.current_price) : null,
      notionalUsd: Number(p.notional_usd),
      unrealizedPnlUsd: p.unrealized_pnl_usd != null ? Number(p.unrealized_pnl_usd) : null,
      openedAt: String(p.opened_at),
    }))

    const recentClosed: ClosedPositionView[] = ((closedRes.data ?? []) as Array<Record<string, unknown>>).map(p => ({
      strategyKey: String(p.strategy_key),
      symbol: String(p.symbol),
      direction: String(p.direction),
      realizedPnlUsd: p.realized_pnl_usd != null ? Number(p.realized_pnl_usd) : null,
      realizedPnlPct: p.realized_pnl_pct != null ? Number(p.realized_pnl_pct) : null,
      exitReason: (p.exit_reason as string | null) ?? null,
      closedAt: String(p.closed_at),
    }))

    const regime = ((regimeRes.data ?? [])[0]?.regime as string | undefined) ?? null

    let deadWorkers: number | null = null
    try {
      const beats = (beatsRes.data ?? []) as Array<{ worker: string; last_seen: string }>
      deadWorkers = beats.length > 0 ? findDeadWorkers(beats).length : null
    } catch { deadWorkers = null }

    const safety = buildSafetyStatus()
    const lastRunAt = runs[0]?.runAt ?? null
    const synergy = buildSynergyReport({
      openPositions: openPositions.map(p => ({
        strategyKey: p.strategyKey, symbol: p.symbol, assetClass: p.assetClass,
        direction: p.direction, notionalUsd: p.notionalUsd,
      })),
      closedPositions: recentClosed
        .filter(p => p.realizedPnlUsd != null)
        .map(p => ({ strategyKey: p.strategyKey, closedAt: p.closedAt, realizedPnlUsd: p.realizedPnlUsd as number })),
      regime,
    })

    return {
      safety,
      brokerReadiness: buildReadinessMatrix(
        safety.brokers.map(b => ({ id: b.id, displayName: b.displayName, configured: b.configured, liveReady: b.liveReady })),
        certsRes
      ),
      runs,
      lastRunAt,
      openPositions,
      recentClosed,
      scorecards,
      coverage: buildCoverageReport(scorecards),
      synergy,
      checklist: buildRunbookChecklist({
        liveTradingEnabled: safety.liveTradingEnabled,
        anyBrokerLiveReady: safety.liveReadyCount > 0,
        anyLiveCandidateStrategy: safety.liveCandidateStrategies.length > 0,
        scorecards,
        lastRunAt,
        ledgerVerified: null,   // nightly cron reports this; never fabricated here
        deadWorkers,
      }),
      fillModel: FILL_MODEL,
      deadWorkers,
    }
  } catch (err) {
    return emptyData(err instanceof Error ? err.message : String(err))
  }
}
