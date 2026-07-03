/**
 * Integration: the Flatten & Halt flag (written by the risk strip) blocks the
 * next trade attempt through the Phase 0 kill switch — UI sets the flag, the
 * kill switch does the enforcement.
 */

import { describe, it, expect, vi } from 'vitest'
import { BasePipelineStrategy } from '@/lib/strategies/BasePipelineStrategy'
import { preTradeRiskCheck } from '@/lib/risk/kill-switch'
import type { Opportunity } from '@/lib/strategies/pipeline-types'
import type { AssetClass, StrategyKey } from '@/lib/strategies/strategy-registry'

type Row = Record<string, unknown>

/** Supabase state as it exists AFTER setTradingHalted(true) ran. */
function supabaseWithHaltFlag(userId: string) {
  const inserts: Record<string, Row[]> = {}
  return {
    _inserts: inserts,
    from: vi.fn((table: string) => {
      const data: Row[] = table === 'system_flags'
        ? [{ user_id: userId, enabled: true, reason: 'manual Flatten & Halt from the risk strip' }]
        : []
      const result = { data, error: null }
      const builder: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) => resolve(result),
      }
      for (const m of ['select', 'eq', 'in', 'gte', 'order', 'limit']) builder[m] = () => builder
      builder.single = () => Promise.resolve({ data: data[0] ?? null, error: null })
      builder.insert = (row: Row) => { (inserts[table] ??= []).push(row); return Promise.resolve({ error: null }) }
      builder.upsert = (row: Row) => { (inserts[table] ??= []).push(row); return Promise.resolve({ error: null }) }
      return builder
    }),
  } as never
}

class TestStrategy extends BasePipelineStrategy {
  readonly key = 'pead' as StrategyKey
  readonly displayName = 'Test'
  readonly assetClass: AssetClass = 'stocks'
}

const OPP: Opportunity = {
  id: 'opp-1', strategyKey: 'pead' as StrategyKey, symbol: 'AAPL',
  direction: 'long', assetClass: 'stocks', strength: 0.8, expectedReturn: 0.05,
  metadata: {}, detectedAt: new Date().toISOString(),
}

describe('Flatten & Halt → kill switch integration', () => {
  it('preTradeRiskCheck blocks once the user flag is set', async () => {
    const supabase = supabaseWithHaltFlag('u1')
    const verdict = await preTradeRiskCheck({ supabase, userId: 'u1', strategyKey: 'pead' })
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toContain('trading_halted')
    expect(verdict.reason).toContain('Flatten & Halt')
  })

  it('the NEXT trade attempt through execute() is blocked and audited', async () => {
    const supabase = supabaseWithHaltFlag('u1')
    const strat = new TestStrategy()
    const size = { fraction: 0.05, notionalUsd: 500, rationale: 'test' }

    const result = await strat.execute(OPP, size, 'u1', supabase)

    expect(result.status).toBe('skipped')
    expect(result.error).toContain('kill_switch')
    expect(result.error).toContain('trading_halted')

    // Blocked, not silently dropped — audit row written.
    const inserts = (supabase as unknown as { _inserts: Record<string, Row[]> })._inserts
    const audit = inserts.audit_logs?.[0]
    expect(audit?.decision).toBe('block')
    expect((audit?.metadata as Row)?.blocked_by).toBe('kill_switch')
  })

  it('another user’s halt flag does NOT block this user', async () => {
    const supabase = supabaseWithHaltFlag('someone-else')
    const verdict = await preTradeRiskCheck({ supabase, userId: 'u1', strategyKey: 'pead' })
    expect(verdict.allowed).toBe(true)
  })
})
