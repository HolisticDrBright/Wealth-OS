/**
 * Items 12–13 + dashboard loader — portfolio synergy math, the runbook
 * checklist derivation, and getPaperValidationData assembly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildSynergyReport,
  detectConflicts,
  computeDrawdownOverlap,
} from '@/lib/paper-trading/synergy'
import { buildRunbookChecklist } from '@/lib/paper-trading/runbook-checklist'
import { assembleScorecard, type ScorecardInputs } from '@/lib/paper-trading/scorecard-core'

function card(overrides: Partial<ScorecardInputs> = {}) {
  return assembleScorecard({
    strategyKey: 'vcp_minervini', assetClass: 'stocks', paperEnabled: true,
    closedTrades: [], entrySlips: [], exitSlips: [], skippedDetails: [],
    auditBlocked: 0, auditVetoes: 0, fillsOpened: 0, exitsClosed: 0,
    openPositions: 0, lastRunAt: null, lastTradeAt: null, rollingBrier: null,
    shadowAvgReturnPct: null, closedShadowTrades: 0,
    ...overrides,
  })
}

// ─── synergy ──────────────────────────────────────────────────────────────────

describe('buildSynergyReport', () => {
  const open = [
    { strategyKey: 'funding_basis_arb', symbol: 'BTC', assetClass: 'crypto', direction: 'neutral', notionalUsd: 3000 },
    { strategyKey: 'liquidation_hunting', symbol: 'BTC', assetClass: 'crypto', direction: 'long', notionalUsd: 2000 },
    { strategyKey: 'narrative_rotation', symbol: 'SOL', assetClass: 'crypto', direction: 'long', notionalUsd: 2000 },
    { strategyKey: 'vcp_minervini', symbol: 'AAPL', assetClass: 'stocks', direction: 'long', notionalUsd: 1000 },
    { strategyKey: 'gamma_exposure', symbol: 'AAPL', assetClass: 'stocks', direction: 'short', notionalUsd: 500 },
  ]

  it('computes exposure by asset class with fractions summing to ~1', () => {
    const r = buildSynergyReport({ openPositions: open, closedPositions: [], regime: null })
    expect(r.totalOpenNotionalUsd).toBe(8500)
    const crypto = r.byAssetClass.find(s => s.key === 'crypto')
    expect(crypto?.notionalUsd).toBe(7000)
    expect(crypto?.fraction).toBeCloseTo(7000 / 8500, 3)
    const sum = r.byAssetClass.reduce((s, x) => s + x.fraction, 0)
    expect(sum).toBeCloseTo(1, 2)
  })

  it('warns when ≥3 strategies chase the same asset-class risk above the limit', () => {
    const r = buildSynergyReport({ openPositions: open, closedPositions: [], regime: null })
    expect(r.warnings.some(w => w.message.includes('single asset-class shock'))).toBe(true)
  })

  it('detects directional conflicts on the same symbol', () => {
    const conflicts = detectConflicts(open)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].symbol).toBe('AAPL')
    expect(conflicts[0].long).toEqual(['vcp_minervini'])
    expect(conflicts[0].short).toEqual(['gamma_exposure'])
  })

  it('drawdown overlap: pairs that lose on the same days are surfaced', () => {
    const closed = []
    for (const day of ['01', '02', '03', '04']) {
      closed.push({ strategyKey: 'a', closedAt: `2026-06-${day}T12:00:00Z`, realizedPnlUsd: -10 })
      closed.push({ strategyKey: 'b', closedAt: `2026-06-${day}T13:00:00Z`, realizedPnlUsd: -5 })
    }
    closed.push({ strategyKey: 'b', closedAt: '2026-06-10T12:00:00Z', realizedPnlUsd: 20 })
    const overlap = computeDrawdownOverlap(closed)
    expect(overlap).toHaveLength(1)
    expect(overlap[0].overlap).toBe(1)
    expect(overlap[0].sharedLossDays).toBe(4)

    const r = buildSynergyReport({ openPositions: [], closedPositions: closed, regime: null })
    expect(r.warnings.some(w => w.message.includes('cosmetic'))).toBe(true)
  })

  it('regime notes reflect the allocator haircuts', () => {
    expect(buildSynergyReport({ openPositions: [], closedPositions: [], regime: 'crisis' }).regimeNote)
      .toContain('CRISIS')
    expect(buildSynergyReport({ openPositions: [], closedPositions: [], regime: 'risk_off' }).regimeNote)
      .toContain('50% haircut')
    expect(buildSynergyReport({ openPositions: [], closedPositions: [], regime: null }).regimeNote)
      .toBeNull()
  })
})

// ─── runbook checklist ────────────────────────────────────────────────────────

describe('buildRunbookChecklist', () => {
  const base = {
    liveTradingEnabled: false,
    anyBrokerLiveReady: false,
    anyLiveCandidateStrategy: false,
    scorecards: [] as ReturnType<typeof card>[],
    lastRunAt: new Date().toISOString(),
    ledgerVerified: null,
    deadWorkers: 0,
  }

  it('paper phase intact → pre-live safety items pass', () => {
    const c = buildRunbookChecklist(base)
    expect(c.preLive.find(i => i.id === 'pl-disabled')?.status).toBe('pass')
    expect(c.preLive.find(i => i.id === 'pl-noready')?.status).toBe('pass')
    expect(c.preLive.find(i => i.id === 'pl-nocandidate')?.status).toBe('pass')
  })

  it('master switch on → FAIL + blocker (protocol violation)', () => {
    const c = buildRunbookChecklist({ ...base, liveTradingEnabled: true })
    expect(c.preLive.find(i => i.id === 'pl-disabled')?.status).toBe('fail')
    expect(c.blockers.some(b => b.includes('LIVE_TRADING_ENABLED'))).toBe(true)
  })

  it('a liveReady broker without sandbox evidence → FAIL + blocker', () => {
    const c = buildRunbookChecklist({ ...base, anyBrokerLiveReady: true })
    expect(c.preLive.find(i => i.id === 'pl-noready')?.status).toBe('fail')
    expect(c.blockers.some(b => b.includes('liveReady'))).toBe(true)
  })

  it('stale runs and thin evidence surface as blockers', () => {
    const c = buildRunbookChecklist({
      ...base,
      lastRunAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    })
    expect(c.weeklyReview.find(i => i.id === 'wr-runs')?.status).toBe('fail')
    expect(c.blockers.some(b => b.includes('stale'))).toBe(true)
    expect(c.blockers.some(b => b.includes('30 closed'))).toBe(true)
  })

  it('a review-ready strategy flips the sample-size criterion to pass', () => {
    const trades = Array.from({ length: 30 }, (_, i) => ({
      closedAt: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T12:00:00Z`,
      returnPct: 0.01,
    }))
    const c = buildRunbookChecklist({ ...base, scorecards: [card({ closedTrades: trades })] })
    expect(c.passFail.find(i => i.id === 'pf-sample')?.status).toBe('pass')
  })
})

// ─── dashboard data loader ────────────────────────────────────────────────────

const loaderDb = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  user: { id: 'u1' } as { id: string } | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: loaderDb.user } }) },
    from: (table: string) => {
      const rows = loaderDb.tables[table] ?? []
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'limit', 'in', 'gte', 'is', 'not']) chain[m] = () => chain
      chain.single = async () => ({ data: rows[0] ?? null, error: null })
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve)
      return chain
    },
  }),
}))

import { getPaperValidationData } from '@/lib/actions/paper-validation'

beforeEach(() => {
  loaderDb.tables = {}
  loaderDb.user = { id: 'u1' }
})
afterEach(() => { vi.unstubAllEnvs() })

describe('getPaperValidationData', () => {
  it('assembles a serializable operator view with live trading OFF', async () => {
    loaderDb.tables.paper_trade_runs = [{
      run_at: new Date().toISOString(), strategies_run: 5, opportunities_found: 3,
      positions_opened: 1, positions_closed: 0, errors: [], regime: 'risk_on',
      skipped_details: [],
    }]
    loaderDb.tables.paper_positions = [{
      strategy_key: 'vcp_minervini', symbol: 'AAPL', asset_class: 'stocks',
      direction: 'long', entry_price: 200, current_price: 202, notional_usd: 1000,
      unrealized_pnl_usd: 10, opened_at: new Date().toISOString(), status: 'open',
      closed_at: null, realized_pnl_pct: null,
    }]
    loaderDb.tables.user_enabled_strategies = [
      { strategy_key: 'vcp_minervini', paper_enabled: true },
      { strategy_key: 'pead', paper_enabled: true },
    ]

    const data = await getPaperValidationData()

    expect(data.error).toBeUndefined()
    expect(data.safety.liveTradingEnabled).toBe(false)
    expect(data.safety.liveReadyCount).toBe(0)
    expect(data.safety.liveCandidateStrategies).toEqual([])
    expect(data.runs).toHaveLength(1)
    expect(data.openPositions).toHaveLength(1)
    // Both paper-enabled strategies get scorecards, even pead with zero data.
    const keys = data.scorecards.map(s => s.strategyKey).sort()
    expect(keys).toContain('vcp_minervini')
    expect(keys).toContain('pead')
    const pead = data.scorecards.find(s => s.strategyKey === 'pead')
    expect(pead?.validationStatus).toBe('no_activity')
    // Checklist reflects the intact paper phase.
    expect(data.checklist.preLive.find(i => i.id === 'pl-disabled')?.status).toBe('pass')
    // Serializable (no functions/classes).
    expect(() => JSON.stringify(data)).not.toThrow()
  })

  it('unauthenticated → safe empty view, still shows safety status', async () => {
    loaderDb.user = null

    const data = await getPaperValidationData()
    expect(data.error).toBe('not signed in')
    expect(data.safety.liveTradingEnabled).toBe(false)
    expect(data.scorecards).toEqual([])
  })

  it('a full sandbox certification in the DB never flips liveReady (item 5 invariant)', async () => {
    loaderDb.tables.broker_certifications = [{
      broker: 'alpaca', environment: 'sandbox',
      tested_order_placement: true, tested_cancel: true, tested_status: true,
      tested_partial_fill: true, tested_rejection: true, tested_bracket_oco: true,
      tested_reconciliation: true, tested_quantity_conversion: true,
      evidence_notes: 'run', certified_by: 'op',
      certified_at: new Date().toISOString(), expires_at: null,
    }]

    const data = await getPaperValidationData()
    const alpaca = data.brokerReadiness.find(r => r.broker === 'alpaca')!
    expect(alpaca.status).toBe('certified_sandbox')
    expect(alpaca.liveReady).toBe(false)
    expect(data.safety.liveReadyCount).toBe(0)
    // Everything else renders honestly pending.
    expect(data.brokerReadiness.filter(r => r.broker !== 'alpaca')
      .every(r => r.status === 'not_certified')).toBe(true)
  })
})
