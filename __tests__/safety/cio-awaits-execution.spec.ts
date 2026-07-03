/**
 * CIODecisionEngine.decide must AWAIT broker execution — the old
 * fire-and-forget (.catch(console.error)) swallowed broker failures and
 * reported 'execute' for trades that never happened.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const executeMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/strategies/all-pipeline-strategies', () => {
  const fakeStrat = {
    key: 'vcp_minervini',
    assetClass: 'stock',
    config: { orderBookImbalance: 'skip' },
    classifyEdge: async () => ({ edgeType: 'technical', rationale: 'test' }),
    runMiroFishConfluence: async () => null,
    runKronosConfluence: async () => null,
    runRedTeam: async () => ({ passed: true, score: 80 }),
    runRiskCheck: async () => ({ veto: false, kellyFraction: 0.05 }),
    sizePosition: async () => ({ fraction: 0.05, notionalUsd: 500, rationale: 'test' }),
    logAudit: async () => {},
    execute: executeMock,
  }
  return { strategyRegistry: new Map([['vcp_minervini', fakeStrat]]) }
})

vi.mock('@/lib/strategies/profile-params', () => ({
  loadUserProfile: async () => ({ profileKey: 'balanced' }),
  loadProfileParams: async () => ({}),
  getEffectiveParams: () => ({
    positionCapPct: 0.2,
    confluenceThreshold: 2,
    confluenceStrengthOverride: null,
    stopLossMultiplier: 1,
  }),
  getEffectiveStrategies: () => new Set(['vcp_minervini']),
}))

vi.mock('@/lib/costs/cost-overrides', () => ({
  loadCostOverrides: async () => ({}),
  effectiveOneWayCostBps: () => 0,
}))

import { CIODecisionEngine } from '@/lib/agents/cio-decision-engine'
import type { Opportunity } from '@/lib/strategies/pipeline-types'

function makeSupabase() {
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit', 'gte']) chain[m] = vi.fn(() => chain)
    chain.single = vi.fn(async () => ({ data: null, error: null }))
    chain.insert = vi.fn(async () => ({ error: null }))
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
    return chain
  })
  return { from } as never
}

const opp: Opportunity = {
  id: 'opp-1',
  strategyKey: 'vcp_minervini',
  symbol: 'AAPL',
  assetClass: 'stock',
  direction: 'long',
  expectedReturn: 0.08, // 800 bps — clears any cost floor
  strength: 0.9,
  metadata: {},
} as never

describe('CIODecisionEngine.decide awaits execution', () => {
  beforeEach(() => {
    executeMock.mockReset()
  })

  it('awaits strat.execute and surfaces a failed broker result on the decision', async () => {
    executeMock.mockResolvedValue({ status: 'failed', broker: 'alpaca', error: 'insufficient buying power' })

    const engine = new CIODecisionEngine()
    const decision = await engine.decide(opp, 'user-1', makeSupabase())

    expect(decision.action).toBe('execute')
    expect(executeMock).toHaveBeenCalledTimes(1)
    expect(decision.execution?.status).toBe('failed')
    expect(decision.execution?.error).toContain('insufficient buying power')
  })

  it('catches a thrown execution and reports it as failed instead of swallowing it', async () => {
    executeMock.mockRejectedValue(new Error('socket hang up'))

    const engine = new CIODecisionEngine()
    const decision = await engine.decide(opp, 'user-1', makeSupabase())

    expect(decision.execution?.status).toBe('failed')
    expect(decision.execution?.error).toContain('socket hang up')
  })

  it('paper mode never calls the real execute path', async () => {
    const engine = new CIODecisionEngine()
    const decision = await engine.decide(opp, 'user-1', makeSupabase(), undefined, { paperMode: true })

    expect(decision.action).toBe('execute')
    expect(executeMock).not.toHaveBeenCalled()
    expect(decision.execution).toBeUndefined()
  })
})
