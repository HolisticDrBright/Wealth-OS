/**
 * W3 wiring — the regime allocator is CONNECTED, not just implemented:
 *  - loadRegimeAdjustedWeights applies regimeConditionalWeights to the
 *    capital-facing weight read path using regime_state history
 *  - executePlaybook (non-dry-run) really writes: kill-switch flag, floor k,
 *    resting-order cancels
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbState = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  writes: {} as Record<string, unknown[]>,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const rows = dbState.tables[table] ?? []
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'limit', 'in', 'gte']) {
        chain[m] = () => chain
      }
      chain.single = async () => ({ data: rows[0] ?? null, error: null })
      chain.upsert = (row: unknown) => {
        ;(dbState.writes[table] ??= []).push(row)
        return chain
      }
      chain.update = (row: unknown) => {
        ;(dbState.writes[table] ??= []).push(row)
        return chain
      }
      chain.insert = (row: unknown) => {
        ;(dbState.writes[table] ??= []).push(row)
        return chain
      }
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve)
      return chain
    },
  }),
}))

import { loadRegimeAdjustedWeights, invalidateCache, DEFAULT_WEIGHTS } from '@/lib/learning/weights'
import { CRISIS_PLAYBOOKS, executePlaybook } from '@/lib/regime/playbooks'

beforeEach(() => {
  dbState.tables = {}
  dbState.writes = {}
})

describe('loadRegimeAdjustedWeights — regime enters the weight read path', () => {
  it('risk_off with insufficient regime evidence → global weights × 0.5 haircut', async () => {
    invalidateCache('u-riskoff')
    dbState.tables.strategy_weights = [{ weights: {} }]
    dbState.tables.regime_state = [{ as_of: '2026-07-03', regime: 'risk_off' }]
    dbState.tables.paper_positions = []

    const { weights, globalWeights, regime } = await loadRegimeAdjustedWeights('u-riskoff')
    expect(regime).toBe('risk_off')
    for (const k of Object.keys(DEFAULT_WEIGHTS)) {
      expect(weights[k]).toBeCloseTo(globalWeights[k] * 0.5, 4)
    }
  })

  it('crisis zeroes every capital weight', async () => {
    invalidateCache('u-crisis')
    dbState.tables.strategy_weights = [{ weights: {} }]
    dbState.tables.regime_state = [{ as_of: '2026-07-03', regime: 'crisis' }]
    dbState.tables.paper_positions = []

    const { weights, regime } = await loadRegimeAdjustedWeights('u-crisis')
    expect(regime).toBe('crisis')
    for (const v of Object.values(weights)) expect(v).toBe(0)
  })

  it('fails open to global weights when regime_state is empty', async () => {
    invalidateCache('u-noregime')
    dbState.tables.strategy_weights = [{ weights: {} }]
    dbState.tables.regime_state = []

    const { weights, globalWeights, regime } = await loadRegimeAdjustedWeights('u-noregime')
    expect(regime).toBeNull()
    expect(weights).toEqual(globalWeights)
  })
})

describe('executePlaybook — non-dry-run writes to the real machinery', () => {
  function makeSupabase() {
    const writes: Record<string, unknown[]> = {}
    const from = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ['eq', 'in', 'select', 'order', 'limit']) chain[m] = vi.fn(() => chain)
      chain.upsert = vi.fn((row: unknown) => {
        ;(writes[table] ??= []).push(row)
        return chain
      })
      chain.update = vi.fn((row: unknown) => {
        ;(writes[table] ??= []).push(row)
        return chain
      })
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: table === 'sleeve_floors' ? [{ id: 'f1', sleeve_key: 'crypto', floor_usd: 100 }] : [], error: null }).then(resolve)
      return chain
    })
    return { client: { from } as never, writes }
  }

  it('liquidity_crash_2020 halts trading, tightens floors, cancels resting intents', async () => {
    const pb = CRISIS_PLAYBOOKS.find(p => p.id === 'liquidity_crash_2020')!
    const supa = makeSupabase()

    const exec = await executePlaybook(pb, { supabase: supa.client, userId: 'u1', dryRun: false })

    expect(exec.dryRun).toBe(false)
    const halt = (supa.writes.system_flags ?? [])[0] as { key: string; enabled: boolean }
    expect(halt?.key).toBe('trading_halted')
    expect(halt?.enabled).toBe(true)
    expect((supa.writes.order_intents ?? []).length).toBeGreaterThan(0)
    expect((supa.writes.sleeve_floors ?? []).length).toBeGreaterThan(0)
    expect(exec.steps.every(s => !s.result.startsWith('FAILED'))).toBe(true)
  })
})
