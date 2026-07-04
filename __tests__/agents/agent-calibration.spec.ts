/**
 * W4 — committee fail-closed + calibrated agent weights.
 *
 *  - Unparseable agent responses become 'defer' (abstain), never 'approve'
 *  - computeCommitteeScore excludes defers from the weighted mean
 *  - calibrateWeights: softmax over accuracy, asymmetric clamp, hardcoded
 *    fallback preserved when the table is empty/unreadable
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

const anthropicCreate = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: anthropicCreate }
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ insert: async () => ({ error: null }) }),
  }),
}))

import {
  HARDCODED_AGENT_WEIGHTS,
  MIN_AGENT_SAMPLES,
  AGENT_MAX_INCREASE,
  calibrateWeights,
  computeCommitteeScore,
  loadAgentWeights,
  runAgentCalibration,
  _clearAgentWeightsCacheForTest,
} from '@/lib/agents/agent-calibration'
import { BaseAgent } from '@/lib/agents/base-agent'
import type { TradeContext } from '@/lib/agents/types'

afterEach(() => {
  vi.clearAllMocks()
  _clearAgentWeightsCacheForTest()
})

class TestAgent extends BaseAgent {
  readonly name = 'TechnicalMarketAgent'
  readonly model = 'claude-sonnet-5'
  buildSystemPrompt() { return 'test' }
}

const context: TradeContext = {
  trade: {
    symbol: 'AAPL', action: 'buy', asset_class: 'stock', notional_value: 1000,
    trader_name: 't', trader_handle: 't', trader_return_pct: 10, trader_win_rate: 60,
  },
  user: { id: 'u1', total_net_worth: 100_000, risk_profile: 'moderate', portfolio: [] },
} as never

describe('base-agent fail-closed (W4)', () => {
  it('unparseable recommendation → defer, never approve', async () => {
    anthropicCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"recommendation": "YOLO_MAX_LONG", "score": 95}' }],
    })
    const out = await new TestAgent().run(context)
    expect(out.recommendation).toBe('defer')
    expect(out.confidence).toBe('low')
  })

  it('non-JSON response → defer', async () => {
    anthropicCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'I think this trade looks great, go for it!' }],
    })
    const out = await new TestAgent().run(context)
    expect(out.recommendation).toBe('defer')
  })

  it('valid recommendation passes through', async () => {
    anthropicCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"recommendation": "reduce", "confidence": "high", "score": 42, "reasoning": "r", "keyPoints": []}' }],
    })
    const out = await new TestAgent().run(context)
    expect(out.recommendation).toBe('reduce')
    expect(out.score).toBe(42)
  })
})

describe('computeCommitteeScore — defers excluded from the mean', () => {
  const weights = { A: 0.5, B: 0.5 }

  it('a defer cannot drag the committee toward 50', () => {
    const withDefer = computeCommitteeScore([
      { agent: 'A', score: 90, recommendation: 'approve' },
      { agent: 'B', score: 50, recommendation: 'defer' },
    ], weights)
    expect(withDefer).toBe(90)   // only the real vote counts
  })

  it('all defers → neutral 50', () => {
    const score = computeCommitteeScore([
      { agent: 'A', score: 10, recommendation: 'defer' },
      { agent: 'B', score: 95, recommendation: 'defer' },
    ], weights)
    expect(score).toBe(50)
  })
})

describe('calibrateWeights', () => {
  it('shifts weight toward accurate agents, asymmetrically clamped', () => {
    const current = { A: 0.3, B: 0.3, C: 0.4 }
    const graded = {
      A: { accuracy: 0.9, samples: MIN_AGENT_SAMPLES },
      B: { accuracy: 0.3, samples: MIN_AGENT_SAMPLES },
    }
    const out = calibrateWeights(current, graded)

    expect(out.A).toBeGreaterThan(out.B)
    // Asymmetric clamp applies BEFORE renormalization: A rises by at most
    // AGENT_MAX_INCREASE (0.30→0.35), B falls by at most AGENT_MAX_DECREASE
    // (0.30→0.15); after renormalizing (÷0.9): A ≤ 0.39, B ≥ 0.16.
    expect(out.A).toBeLessThanOrEqual((0.3 + AGENT_MAX_INCREASE) / 0.9 + 0.001)
    expect(out.B).toBeGreaterThanOrEqual(0.15 / 0.9 - 0.001)
    // Unevidenced C keeps (approximately) its weight.
    expect(out.C).toBeGreaterThan(0.35)
    // Renormalized.
    const sum = Object.values(out).reduce((s, v) => s + v, 0)
    expect(sum).toBeCloseTo(1, 2)
  })

  it('insufficient samples → weights unchanged (after renormalize)', () => {
    const current = { A: 0.5, B: 0.5 }
    const out = calibrateWeights(current, { A: { accuracy: 1, samples: MIN_AGENT_SAMPLES - 1 } })
    expect(out.A).toBeCloseTo(0.5, 3)
    expect(out.B).toBeCloseTo(0.5, 3)
  })
})

describe('loadAgentWeights — table with hardcoded fallback', () => {
  it('empty table → hardcoded weights', async () => {
    const supabase = {
      from: () => ({ select: async () => ({ data: [], error: null }) }),
    } as never
    expect(await loadAgentWeights(supabase)).toEqual(HARDCODED_AGENT_WEIGHTS)
  })

  it('read error → hardcoded weights', async () => {
    const supabase = {
      from: () => ({ select: async () => ({ data: null, error: { message: 'no table' } }) }),
    } as never
    expect(await loadAgentWeights(supabase)).toEqual(HARDCODED_AGENT_WEIGHTS)
  })

  it('table rows override known agents; unknown rows ignored', async () => {
    const supabase = {
      from: () => ({
        select: async () => ({
          data: [
            { agent_name: 'RiskManagementAgent', weight: 0.2 },
            { agent_name: 'MadeUpAgent', weight: 0.9 },
          ],
          error: null,
        }),
      }),
    } as never
    const w = await loadAgentWeights(supabase)
    expect(w.RiskManagementAgent).toBe(0.2)
    expect(w).not.toHaveProperty('MadeUpAgent')
    expect(w.MiroFishSimulationAgent).toBe(HARDCODED_AGENT_WEIGHTS.MiroFishSimulationAgent)
  })

  it('no client → hardcoded weights', async () => {
    expect(await loadAgentWeights(undefined)).toEqual(HARDCODED_AGENT_WEIGHTS)
  })
})

describe('loadAgentWeights cache (audit residue 5)', () => {
  it('reads the table once per TTL window', async () => {
    const select = vi.fn(async () => ({
      data: [{ agent_name: 'RiskManagementAgent', weight: 0.2 }], error: null,
    }))
    const supabase = { from: () => ({ select }) } as never

    const a = await loadAgentWeights(supabase)
    const b = await loadAgentWeights(supabase)
    expect(a.RiskManagementAgent).toBe(0.2)
    expect(b.RiskManagementAgent).toBe(0.2)
    expect(select).toHaveBeenCalledTimes(1)   // second call served from cache
  })
})

describe('runAgentCalibration reads agent_performance_logs (audit residue 5)', () => {
  it('per-agent committee scores are graded against closed positions', async () => {
    const now = Date.now()
    const upserts: unknown[] = []
    const tables: Record<string, unknown[]> = {
      agent_weights: [],
      audit_logs: [],
      paper_positions: [
        { symbol: 'AAPL', opened_at: new Date(now + 3_600_000).toISOString(), realized_pnl_usd: 50 },
      ],
      agent_performance_logs: [{
        scenario: {
          trade: { symbol: 'AAPL' },
          // ≥60 = approving vote (correct: trade won); ≤40 = rejecting (wrong)
          agentScores: { TechnicalMarketAgent: 80, MacroRegimeAgent: 30, QuantScreeningAgent: 50 },
        },
        decision: 'execute',
        created_at: new Date(now).toISOString(),
      }],
    }
    const supabase = {
      from: (table: string) => {
        const rows = tables[table] ?? []
        const chain: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'gte', 'not', 'limit', 'order']) chain[m] = () => chain
        chain.upsert = async (rowsIn: unknown) => { upserts.push(rowsIn); return { error: null } }
        chain.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve)
        return chain
      },
    } as never

    const result = await runAgentCalibration(supabase)

    expect(result.graded.TechnicalMarketAgent).toEqual({ accuracy: 1, samples: 1 })
    expect(result.graded.MacroRegimeAgent).toEqual({ accuracy: 0, samples: 1 })
    // Neutral band (41–59) abstains — never graded.
    expect(result.graded.QuantScreeningAgent).toBeUndefined()
    expect(result.updated).toBe(true)
    expect(upserts.length).toBe(1)
  })
})
