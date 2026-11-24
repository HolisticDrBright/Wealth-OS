/**
 * Roadmap #7 — what the AI committee costs, and whether its vetoes pay.
 *  - real per-call cost from token usage × price (failed calls recorded too),
 *  - every model call in the app goes through the meter,
 *  - committee decisions graded on what the trade would have done,
 *  - per-agent veto value vs cost → keep / cut / never vetoes / failing,
 *  - turning an agent off: evidence-gated, approval first, never a protected
 *    safety check; turned-off agents make no call and cast no vote.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { costOf, priceKey } from '@/lib/ai/usage'
import { committeeReport, cutSummary, type GradedRun, type UsageRow } from '@/lib/agents/committee-value'
import { gradeOutcome, directionOf } from '@/lib/agents/committee-runs'
import { shadowCheckOf, STRATEGY_CHECKS } from '@/lib/agents/committee-data'
import {
  MODEL_PRICES_USD_PER_MTOK, CACHE_WRITE_MULTIPLIER, CACHE_READ_MULTIPLIER, COMMITTEE_GRADE_HORIZON_DAYS,
  COMMITTEE_REVIEW_LOOKBACK_DAYS, COMMITTEE_MIN_GRADED_VETOES, PROTECTED_COMMITTEE_AGENTS,
} from '@/lib/config/product-defaults'
import { roundTripCostBps } from '@/lib/costs/transaction-costs'

const read = (p: string) => readFileSync(join(process.cwd(), ...p.split('/')), 'utf8')

vi.hoisted(() => { process.env.ANTHROPIC_API_KEY ??= 'test-key' })   // the SDK client is built at import
const db = vi.hoisted(() => ({
  rows: [] as Array<{ table: string; op: string; row: Record<string, unknown> }>,
  tables: {} as Record<string, Array<Record<string, unknown>>>,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'gte', 'is', 'lte', 'limit']) c[m] = () => c
      c.insert = async (row: Record<string, unknown>) => { db.rows.push({ table, op: 'insert', row }); return { error: null } }
      c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: db.tables[table] ?? [], error: null }).then(ok)
      return c
    },
  }),
}))
beforeEach(() => { db.rows = []; db.tables = {} })

// ─── Cost ────────────────────────────────────────────────────────────────────

describe('pricing and cost (product defaults)', () => {
  it('prices for every model the app calls', () => {
    expect(MODEL_PRICES_USD_PER_MTOK['claude-opus-4-6']).toEqual({ input: 5, output: 25 })
    expect(MODEL_PRICES_USD_PER_MTOK['claude-sonnet-4-6']).toEqual({ input: 3, output: 15 })
    expect(MODEL_PRICES_USD_PER_MTOK['claude-haiku-4-5']).toEqual({ input: 1, output: 5 })
    expect(MODEL_PRICES_USD_PER_MTOK['claude-sonnet-5']).toEqual({ input: 2, output: 10 })
    expect(CACHE_WRITE_MULTIPLIER).toBe(1.25)
    expect(CACHE_READ_MULTIPLIER).toBe(0.1)
    expect(COMMITTEE_GRADE_HORIZON_DAYS).toBe(5)
    expect(COMMITTEE_REVIEW_LOOKBACK_DAYS).toBe(90)
    expect(COMMITTEE_MIN_GRADED_VETOES).toBe(20)
    expect(PROTECTED_COMMITTEE_AGENTS).toEqual(['RiskManagementAgent'])
  })
  it('dated snapshots share their family price; unknown models are null, not guessed', () => {
    expect(priceKey('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5')
    expect(costOf('claude-haiku-4-5-20251001', { input_tokens: 1_000_000, output_tokens: 0 })).toBe(1)
    expect(costOf('some-other-model', { input_tokens: 10, output_tokens: 10 })).toBeNull()
  })
  it('input + output + cache writes (1.25×) + cache reads (0.1×)', () => {
    expect(costOf('claude-opus-4-6', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(30)
    expect(costOf('claude-sonnet-4-6', {
      input_tokens: 100_000, output_tokens: 10_000, cache_creation_input_tokens: 200_000, cache_read_input_tokens: 1_000_000,
    })).toBeCloseTo((100_000 + 200_000 * 1.25 + 1_000_000 * 0.1) * 3 / 1e6 + 10_000 * 15 / 1e6, 12)
  })
})

describe('meteredCreate', () => {
  it('records the real usage and cost, and returns the message unchanged', async () => {
    const { meteredCreate } = await import('@/lib/ai/usage')
    const msg = { content: [], usage: { input_tokens: 2_000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }
    const client = { messages: { create: vi.fn(async () => msg) } }
    const out = await meteredCreate(client as never, { model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [] }, {
      caller: 'committee', agentName: 'MacroRegimeAgent', userId: 'u1', runId: 'r1', symbol: 'AAPL',
    })
    expect(out).toBe(msg)
    await new Promise(r => setTimeout(r, 0))
    expect(db.rows[0]).toMatchObject({ table: 'llm_usage_log', row: {
      caller: 'committee', agent_name: 'MacroRegimeAgent', user_id: 'u1', run_id: 'r1', ok: true,
      input_tokens: 2_000, output_tokens: 500, cost_usd: (2_000 * 1 + 500 * 5) / 1e6,
    } })
  })
  it('a response without usage still returns normally (metering never changes the call)', async () => {
    const { meteredCreate } = await import('@/lib/ai/usage')
    const msg = { content: [{ type: 'text', text: 'ok' }] }
    const client = { messages: { create: vi.fn(async () => msg) } }
    expect(await meteredCreate(client as never, { model: 'claude-opus-4-6', max_tokens: 10, messages: [] }, { caller: 'x' })).toBe(msg)
  })
  it('a failed call is recorded (cost $0, the error) and still throws', async () => {
    const { meteredCreate } = await import('@/lib/ai/usage')
    const client = { messages: { create: vi.fn(async () => { throw new Error('400 adaptive thinking is not supported') }) } }
    await expect(meteredCreate(client as never, { model: 'claude-haiku-4-5', max_tokens: 10, messages: [] }, { caller: 'committee', agentName: 'X' }))
      .rejects.toThrow('adaptive thinking')
    await new Promise(r => setTimeout(r, 0))
    expect(db.rows[0].row).toMatchObject({ ok: false, cost_usd: 0, error: expect.stringContaining('adaptive') })
  })
  it('every model call in the app goes through the meter', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p); continue }
        if (!/\.(ts|tsx)$/.test(name) || p.endsWith(join('lib', 'ai', 'usage.ts'))) continue
        if (/\.messages\.create\(/.test(readFileSync(p, 'utf8'))) offenders.push(p)
      }
    }
    walk(join(process.cwd(), 'lib')); walk(join(process.cwd(), 'app'))
    expect(offenders).toEqual([])
  })
})

// ─── Turned-off agents ───────────────────────────────────────────────────────

vi.mock('@/lib/ai/usage', async (orig) => {
  const real = await orig<typeof import('@/lib/ai/usage')>()
  return { ...real, meteredCreate: vi.fn(real.meteredCreate) }
})

describe('turned-off agents make no call; protected agents always run', () => {
  const ctx = (disabled: string[]) => ({
    trade: { symbol: 'AAPL', action: 'buy' as const, asset_class: 'stock' as const, notional_value: 500, trader_name: 't', trader_handle: 't', trader_return_pct: 1, trader_win_rate: 50 },
    user: { id: 'u1', total_net_worth: 10_000, portfolio: [] },
    runId: 'run-1', disabledAgents: disabled,
  })
  it('a turned-off agent abstains without a model call', async () => {
    const usage = await import('@/lib/ai/usage')
    const { MacroRegimeAgent } = await import('@/lib/agents/agents/all-agents')
    ;(usage.meteredCreate as unknown as ReturnType<typeof vi.fn>).mockClear()
    const out = await new MacroRegimeAgent().run(ctx(['MacroRegimeAgent']) as never)
    expect(out).toMatchObject({ recommendation: 'defer', metadata: { disabled: true } })
    expect(usage.meteredCreate).not.toHaveBeenCalled()
  })
  it('the risk manager runs even if a settings row says off', async () => {
    const usage = await import('@/lib/ai/usage')
    const { RiskManagementAgent } = await import('@/lib/agents/agents/all-agents')
    ;(usage.meteredCreate as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      content: [{ type: 'text', text: '{"recommendation":"reject","score":10,"confidence":"high","reasoning":"r","keyPoints":[]}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }) as never)
    const out = await new RiskManagementAgent().run(ctx(['RiskManagementAgent']) as never)
    expect(out.recommendation).toBe('reject')
  })
  it('loading the settings drops protected agents too (second seatbelt)', async () => {
    const { loadDisabledAgents } = await import('@/lib/agents/committee-runs')
    db.tables.committee_agent_settings = [{ agent_name: 'RiskManagementAgent' }, { agent_name: 'TaxOptimizationAgent' }]
    expect(await loadDisabledAgents('u1')).toEqual(['TaxOptimizationAgent'])
  })
})

// ─── Grading ─────────────────────────────────────────────────────────────────

describe('grading a committee decision', () => {
  const series = [
    { date: '2026-11-02', close: 100 }, { date: '2026-11-05', close: 104 },
    { date: '2026-11-06', close: 105 }, { date: '2026-11-10', close: 110 },
  ]
  const cost = roundTripCostBps('stocks') / 10_000
  it('long: the move to the close on/before the horizon, after costs', () => {
    const g = gradeOutcome({ series, entryPrice: 100, decidedAt: '2026-11-02T15:00:00Z', action: 'buy', assetClass: 'stock' })!
    expect(g.exitPrice).toBe(105)                       // horizon Nov 7 → last close on/before it (Nov 6)
    expect(g.returnPct).toBeCloseTo(directionOf('buy') * (g.exitPrice / 100 - 1) - cost, 12)
  })
  it('short: sign flips', () => {
    const g = gradeOutcome({ series, entryPrice: 100, decidedAt: '2026-11-02T15:00:00Z', action: 'short', assetClass: 'stock' })!
    expect(g.returnPct).toBeCloseTo(-(g.exitPrice / 100 - 1) - cost, 12)
  })
  it('not gradable without an entry price or before the horizon is in the data', () => {
    expect(gradeOutcome({ series, entryPrice: null, decidedAt: '2026-11-02T15:00:00Z', action: 'buy', assetClass: 'stock' })).toBeNull()
    expect(gradeOutcome({ series, entryPrice: 100, decidedAt: '2026-11-08T15:00:00Z', action: 'buy', assetClass: 'stock' })).toBeNull()
  })
})

// ─── The report ──────────────────────────────────────────────────────────────

const AGENTS = ['MacroRegimeAgent', 'TaxOptimizationAgent', 'QuantScreeningAgent', 'RiskManagementAgent', 'TechnicalMarketAgent']
function runs(n: number, votes: Record<string, string>, outcome: number): GradedRun[] {
  return Array.from({ length: n }, () => ({ votes, outcomeReturn: outcome, notionalUsd: 1_000, decision: 'reject' }))
}
const usage = (agent: string, n: number, cost: number, failed = 0): UsageRow[] =>
  Array.from({ length: n }, (_, i) => ({ agentName: agent, caller: 'committee', costUsd: cost, ok: i >= failed }))

describe('committeeReport', () => {
  const report = committeeReport({
    runs: [
      ...runs(25, { MacroRegimeAgent: 'reject', TaxOptimizationAgent: 'approve', RiskManagementAgent: 'reject' }, -0.04),  // vetoed losers
      ...runs(25, { QuantScreeningAgent: 'reject', TaxOptimizationAgent: 'approve' }, 0.03),                              // vetoed winners
    ],
    totalRuns: 50,
    usage: [...usage('MacroRegimeAgent', 50, 0.02), ...usage('QuantScreeningAgent', 50, 0.002), ...usage('TaxOptimizationAgent', 50, 0.002),
      ...usage('TechnicalMarketAgent', 12, 0, 9), { agentName: 'CIOSynthesis', caller: 'cio_synthesis', costUsd: 1, ok: true },
      { agentName: 'Kronos', caller: 'kronos', costUsd: 0.5, ok: true }],
    committeeAgents: AGENTS,
    shadowBlocks: { Kronos: [-20, -10, 5] },
    strategyCallers: STRATEGY_CHECKS,
    disabled: ['TaxOptimizationAgent'],
  })
  const row = (a: string) => report.agents.find(x => x.agent === a)!

  it('vetoes that avoided losses beat their cost → keep', () => {
    expect(row('MacroRegimeAgent')).toMatchObject({ vetoes: 25, rightVetoes: 25, verdict: 'keep', canDisable: false })
    expect(row('MacroRegimeAgent').vetoValueUsd).toBeCloseTo(25 * 40, 6)
    expect(row('MacroRegimeAgent').costUsd).toBeCloseTo(1, 6)
  })
  it('vetoes that blocked winners → cut', () => {
    expect(row('QuantScreeningAgent')).toMatchObject({ vetoes: 25, rightVetoes: 0, verdict: 'cut', canDisable: true })
    expect(row('QuantScreeningAgent').vetoValueUsd).toBeCloseTo(-25 * 30, 6)
  })
  it('an agent that never says no → never vetoes (it can be cut)', () => {
    expect(row('TaxOptimizationAgent')).toMatchObject({ vetoes: 0, gradedVotes: 50, verdict: 'never_vetoes', canDisable: true, disabled: true })
  })
  it('an agent whose calls mostly fail → failing', () => {
    expect(row('TechnicalMarketAgent')).toMatchObject({ calls: 12, failedCalls: 9, verdict: 'failing', canDisable: true })
  })
  it('the risk manager is protected whatever its numbers', () => {
    expect(row('RiskManagementAgent')).toMatchObject({ verdict: 'protected', canDisable: false })
  })
  it('strategy checks are graded from the shadow portfolio; MiroFish (never blocks) says so', () => {
    expect(row('Kronos')).toMatchObject({ path: 'strategy', vetoes: 3, rightVetoes: 2, canDisable: false })
    expect(row('Kronos').vetoValueUsd).toBe(25)
    expect(row('Kronos').costUsd).toBe(0.5)
    expect(row('MiroFish (strategy)').reason).toMatch(/No graded blocks yet|No calls/)
  })
  it('totals: committee cost includes the synthesis; cost per decision', () => {
    expect(report.totals.committeeCostUsd).toBeCloseTo(1 + 0.1 + 0.1 + 1, 6)
    expect(report.totals.costPerRunUsd).toBeCloseTo(2.2 / 50, 6)
    expect(report.totals.strategyAiCostUsd).toBe(0.5)
  })
  it('the cut summary is plain and reversible', () => {
    expect(cutSummary(row('QuantScreeningAgent'))).toMatch(/^Turn off QuantScreeningAgent .* turn it back on any time\.$/)
  })
  it('classifies shadow blocks by the engine’s reason text', () => {
    expect(shadowCheckOf('kronos contradicts: bearish skew riskBlocked')).toBe('Kronos')
    expect(shadowCheckOf('edge_below_cost_floor: gross=3bps')).toBeNull()
  })
})

// ─── The switch ──────────────────────────────────────────────────────────────

function fakeUser(tables: Record<string, Array<Record<string, unknown>>>) {
  const ops: Array<{ table: string; op: string; row: Record<string, unknown> }> = []
  const client = {
    from: (table: string) => {
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'gte', 'limit']) c[m] = () => c
      c.insert = async (row: Record<string, unknown>) => { ops.push({ table, op: 'insert', row }); return { error: null } }
      c.upsert = async (row: Record<string, unknown>) => { ops.push({ table, op: 'upsert', row }); return { error: null } }
      c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(ok)
      return c
    },
  }
  return { client: client as never, ops }
}

describe('turning an agent off', () => {
  it('refuses a protected agent', async () => {
    const { setCommitteeAgentEnabled } = await import('@/lib/agents/committee-data')
    const { client, ops } = fakeUser({})
    expect((await setCommitteeAgentEnabled(client, 'u1', 'RiskManagementAgent', false)).ok).toBe(false)
    expect(ops).toEqual([])
  })
  it('refuses without evidence', async () => {
    const { setCommitteeAgentEnabled } = await import('@/lib/agents/committee-data')
    const { client, ops } = fakeUser({ committee_runs: [], llm_usage_log: [] })
    const r = await setCommitteeAgentEnabled(client, 'u1', 'QuantScreeningAgent', false)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/evidence/)
    expect(ops).toEqual([])
  })
  it('with evidence: approval recorded FIRST, then the setting', async () => {
    const { setCommitteeAgentEnabled } = await import('@/lib/agents/committee-data')
    const { client, ops } = fakeUser({
      committee_runs: Array.from({ length: 25 }, () => ({ votes: { QuantScreeningAgent: 'reject' }, outcome_return: 0.03, notional_usd: 1_000, decision: 'reject' })),
      llm_usage_log: [],
    })
    expect(await setCommitteeAgentEnabled(client, 'u1', 'QuantScreeningAgent', false)).toEqual({ ok: true })
    expect(ops.map(o => `${o.table}:${o.op}`)).toEqual(['automation_approvals:insert', 'committee_agent_settings:upsert'])
    expect(ops[0].row).toMatchObject({ kind: 'cut_agent', subject: 'QuantScreeningAgent' })
    expect(ops[1].row).toMatchObject({ agent_name: 'QuantScreeningAgent', enabled: false })
  })
  it('turning one back on is always allowed', async () => {
    const { setCommitteeAgentEnabled } = await import('@/lib/agents/committee-data')
    const { client, ops } = fakeUser({})
    expect(await setCommitteeAgentEnabled(client, 'u1', 'QuantScreeningAgent', true)).toEqual({ ok: true })
    expect(ops).toEqual([{ table: 'committee_agent_settings', op: 'upsert', row: expect.objectContaining({ enabled: true }) }])
  })
})

describe('contracts', () => {
  it('the engine gives every run an id, skips turned-off agents, and records the run', () => {
    const src = read('lib/agents/cio-decision-engine.ts')
    expect(src).toContain('runId: context.runId ?? crypto.randomUUID()')
    expect(src).toContain('loadDisabledAgents(')
    expect(src).toContain('recordCommitteeRun(ctx, decision)')
  })
  it('the daily cron grades runs; the page is pro-only and linked', () => {
    expect(read('lib/cron/tasks.ts')).toContain('gradeCommitteeRuns(supabase)')
    expect(read('app/(app)/strategies/committee/page.tsx')).toContain("!== 'pro'")
    expect(read('components/layout/sidebar.tsx')).toContain("'/strategies/committee'")
  })
  it('migration 20260704s: tables with RLS; usage and runs written only by the service role', () => {
    const sql = read('supabase/migrations/20260704s_ai_committee_costs.sql')
    for (const t of ['llm_usage_log', 'committee_runs', 'committee_agent_settings']) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${t}`)
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`)
    }
    expect(sql).toContain("'cut_agent'")
    for (const k of ['enable_strategy', 'follow_trader', 'auto_copy', 'accept_rebalance', 'setup_ladder', 'core_rebalance', 'deposit', 'explore_shrink']) {
      expect(sql).toContain(`'${k}'`)
    }
  })
})
