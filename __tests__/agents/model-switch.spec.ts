/**
 * Model switch: Haiku 4.5 → Haiku 5.5, Sonnet 4.6 / Sonnet 5 → Sonnet 5.5,
 * Opus 4.6 → Opus 5.5.
 *  - one place names the models and effort levels (product defaults),
 *  - committee votes: adaptive thinking (which Haiku 4.5 rejected), low effort,
 *    a token cap with room for thinking,
 *  - safety declines are abstentions, never votes; Opus 5.5 / Sonnet 5.5 calls
 *    use server-side fallback; cost is priced at the model that served it,
 *  - responses are read by block type (thinking blocks come first now).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import {
  AI_MODEL_FAST, AI_MODEL_STANDARD, AI_MODEL_DEEP, AI_EFFORT_VOTE, AI_EFFORT_ANALYSIS,
  AI_VOTE_MAX_TOKENS, AI_FALLBACK_MODELS, MODEL_LONG_PROMPT_PRICES, MODEL_PRICES_USD_PER_MTOK,
} from '@/lib/config/product-defaults'

vi.hoisted(() => { process.env.ANTHROPIC_API_KEY ??= 'test-key' })
vi.mock('@/lib/ai/usage', async (orig) => {
  const real = await orig<typeof import('@/lib/ai/usage')>()
  return { ...real, meteredCreate: vi.fn(real.meteredCreate) }
})

const read = (p: string) => readFileSync(join(process.cwd(), ...p.split('/')), 'utf8')

const logged = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) c[m] = () => c
      c.insert = async (row: Record<string, unknown>) => { logged.rows.push(row); return { error: null } }
      c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok)
      return c
    },
  }),
}))
beforeEach(() => { logged.rows = [] })

describe('the models (product defaults)', () => {
  it('Haiku 5.5 / Sonnet 5.5 / Opus 5.5, low effort for votes, medium for analysis', () => {
    expect(AI_MODEL_FAST).toBe('claude-haiku-5-5')
    expect(AI_MODEL_STANDARD).toBe('claude-sonnet-5-5')
    expect(AI_MODEL_DEEP).toBe('claude-opus-5-5')
    expect(AI_EFFORT_VOTE).toBe('low')
    expect(AI_EFFORT_ANALYSIS).toBe('medium')
    expect(AI_VOTE_MAX_TOKENS).toBe(4000)
    expect(AI_FALLBACK_MODELS).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5'])
  })
  it('prices: Haiku 5.5 $0.10/$0.50 (over 100K-token prompts $0.50/$2.50), Sonnet 5.5 $2/$10, Opus 5.5 $4/$20', () => {
    expect(MODEL_PRICES_USD_PER_MTOK[AI_MODEL_FAST]).toEqual({ input: 0.10, output: 0.50 })
    expect(MODEL_PRICES_USD_PER_MTOK[AI_MODEL_STANDARD]).toEqual({ input: 2, output: 10 })
    expect(MODEL_PRICES_USD_PER_MTOK[AI_MODEL_DEEP]).toEqual({ input: 4, output: 20 })
    expect(MODEL_LONG_PROMPT_PRICES['claude-haiku-5-5']).toEqual({ thresholdTokens: 100_000, input: 0.5, output: 2.5 })
  })
  // Streaming chat routes are a separate, later switch (not part of this one).
  const NOT_YET = ['app/api/tax-advisor/route.ts', 'app/api/portfolio-chat/route.ts', 'app/api/retirement-advice/route.ts']
    .map(f => join(process.cwd(), ...f.split('/')))
  it('no switched call site still names a previous-generation model', () => {
    const OLD = /claude-(haiku-4-5|sonnet-4-6|opus-4-6|sonnet-5['"])/
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { walk(p); continue }
        if (!/\.(ts|tsx)$/.test(name) || NOT_YET.includes(p)) continue
        // Price tables / the meter's docs name old models on purpose.
        if (p.endsWith(join('lib', 'config', 'product-defaults.ts')) || p.endsWith(join('lib', 'ai', 'usage.ts'))) continue
        if (OLD.test(readFileSync(p, 'utf8'))) offenders.push(p)
      }
    }
    walk(join(process.cwd(), 'lib')); walk(join(process.cwd(), 'app'))
    expect(offenders).toEqual([])
  })
})

describe('the committee agents', () => {
  it('nine Haiku-tier agents on Haiku 5.5; orchestrator and macro on Sonnet 5.5; risk manager on Opus 5.5', async () => {
    const a = await import('@/lib/agents/agents/all-agents')
    expect(new a.OrchestratorAgent().model).toBe(AI_MODEL_STANDARD)
    expect(new a.MacroRegimeAgent().model).toBe(AI_MODEL_STANDARD)
    expect(new a.RiskManagementAgent().model).toBe(AI_MODEL_DEEP)
    const fast = [a.ClientProfileAgent, a.PortfolioDiagnosticAgent, a.FundamentalEquityAgent, a.TechnicalMarketAgent,
      a.QuantScreeningAgent, a.CryptoIntelligenceAgent, a.ForexStrategyAgent, a.TaxOptimizationAgent, a.RetirementExecutionAgent]
    expect(fast).toHaveLength(9)
    for (const Agent of fast) expect(new Agent().model, Agent.name).toBe(AI_MODEL_FAST)
  })

  const ctx = {
    trade: { symbol: 'AAPL', action: 'buy' as const, asset_class: 'stock' as const, notional_value: 500, trader_name: 't', trader_handle: 't', trader_return_pct: 1, trader_win_rate: 50 },
    user: { id: 'u1', total_net_worth: 10_000, portfolio: [] },
    runId: 'run-1',
  }

  it('each vote: adaptive thinking, low effort, a cap with room for thinking', async () => {
    const usage = await import('@/lib/ai/usage')
    const mc = usage.meteredCreate as unknown as ReturnType<typeof vi.fn>
    mc.mockClear()
    mc.mockImplementationOnce(async () => ({
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"recommendation":"approve","score":70,"confidence":"high","reasoning":"ok","keyPoints":[]}' }],
      stop_reason: 'end_turn', model: AI_MODEL_FAST, usage: { input_tokens: 100, output_tokens: 50 },
    }))
    const { TechnicalMarketAgent } = await import('@/lib/agents/agents/all-agents')
    const out = await new TechnicalMarketAgent().run(ctx as never)
    expect(out.recommendation).toBe('approve')                       // read past the leading thinking block
    expect(mc.mock.calls[0][1]).toEqual(expect.objectContaining({
      model: AI_MODEL_FAST, max_tokens: AI_VOTE_MAX_TOKENS,
      thinking: { type: 'adaptive' }, output_config: { effort: 'low' },
    }))
  })

  it('a safety decline is an abstention, never a vote', async () => {
    const usage = await import('@/lib/ai/usage')
    ;(usage.meteredCreate as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      content: [{ type: 'text', text: '{"recommendation":"reject","score":5}' }],
      stop_reason: 'refusal', model: AI_MODEL_FAST, usage: { input_tokens: 10, output_tokens: 0 },
    }))
    const { TaxOptimizationAgent } = await import('@/lib/agents/agents/all-agents')
    const out = await new TaxOptimizationAgent().run(ctx as never)
    expect(out).toMatchObject({ recommendation: 'defer', metadata: { declined: true } })
  })
})

describe('the meter on the new models', () => {
  it('Opus 5.5 and Sonnet 5.5 use server-side fallback; cost is priced at the model that served it', async () => {
    const { meteredCreate, FALLBACK_BETA } = await import('@/lib/ai/usage')
    const betaCreate = vi.fn(async () => ({
      content: [], stop_reason: 'end_turn', model: 'claude-opus-4-8',            // a fallback served it
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    }))
    const plainCreate = vi.fn()
    const client = { messages: { create: plainCreate }, beta: { messages: { create: betaCreate } } }
    await meteredCreate(client as never, { model: AI_MODEL_DEEP, max_tokens: 10, messages: [] }, { caller: 'cio_synthesis' })
    expect(plainCreate).not.toHaveBeenCalled()
    expect(betaCreate).toHaveBeenCalledWith(expect.objectContaining({ model: AI_MODEL_DEEP, betas: [FALLBACK_BETA], fallbacks: 'default' }))
    await new Promise(r => setTimeout(r, 0))
    expect(logged.rows[0]).toMatchObject({ model: 'claude-opus-4-8', cost_usd: 5, stop_reason: 'end_turn' })
  })
  it('Haiku 5.5 uses the regular endpoint (it has no server-side fallback)', async () => {
    const { meteredCreate } = await import('@/lib/ai/usage')
    const plainCreate = vi.fn(async () => ({ content: [], stop_reason: 'refusal', model: AI_MODEL_FAST, usage: { input_tokens: 0, output_tokens: 0 } }))
    const betaCreate = vi.fn()
    await meteredCreate({ messages: { create: plainCreate }, beta: { messages: { create: betaCreate } } } as never,
      { model: AI_MODEL_FAST, max_tokens: 10, messages: [] }, { caller: 'committee' })
    expect(betaCreate).not.toHaveBeenCalled()
    await new Promise(r => setTimeout(r, 0))
    expect(logged.rows[0]).toMatchObject({ stop_reason: 'refusal' })
  })
  it('Haiku 5.5 bills prompts over 100K tokens at its second rate card', async () => {
    const { costOf } = await import('@/lib/ai/usage')
    expect(costOf(AI_MODEL_FAST, { input_tokens: 50_000, output_tokens: 1_000 })).toBeCloseTo((50_000 * 0.1 + 1_000 * 0.5) / 1e6, 12)
    expect(costOf(AI_MODEL_FAST, { input_tokens: 150_000, output_tokens: 1_000 })).toBeCloseTo((150_000 * 0.5 + 1_000 * 2.5) / 1e6, 12)
  })
})

describe('reading responses on the new models', () => {
  it('nothing reads a response by position (thinking blocks come first now)', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { walk(p); continue }
        if (/\.(ts|tsx)$/.test(name) && /msg\.content\[0\]|response\.content\[0\]/.test(readFileSync(p, 'utf8'))) offenders.push(p)
      }
    }
    walk(join(process.cwd(), 'lib')); walk(join(process.cwd(), 'app'))
    expect(offenders).toEqual([])
  })
  it('Kronos and MiroFish treat a decline as no signal, not a neutral reading', () => {
    expect(read('lib/kronos/KronosClient.ts')).toContain("if (wasDeclined(msg)) throw new Error('kronos forecast declined')")
    expect(read('lib/agents/mirofish-client.ts')).toContain("if (wasDeclined(msg)) throw new Error('simulation declined by safety check')")
    expect(read('app/api/opportunities/route.ts')).toContain('wasDeclined(msg)')
  })
  it('synthesis and simulations run on Opus 5.5 at medium effort', () => {
    for (const f of ['lib/agents/cio-decision-engine.ts', 'lib/agents/mirofish-client.ts']) {
      const src = read(f)
      expect(src, f).toContain('model: AI_MODEL_DEEP')
      expect(src, f).toContain('output_config: { effort: AI_EFFORT_ANALYSIS }')
    }
  })
  it('migration 20260704t records the stop reason', () => {
    expect(read('supabase/migrations/20260704t_llm_stop_reason.sql')).toContain('ADD COLUMN IF NOT EXISTS stop_reason text')
  })
})
