/**
 * Item 3 regression — the scheduled scan (POST /api/internal/scan-all) must
 * attribute every strategy audit call to the user it ran for. Unattributed
 * audit rows are invisible to the per-user paper scorecards.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const logAuditMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@/lib/strategies/all-pipeline-strategies', () => ({
  getAllPipelineStrategies: () => [{
    key: 'vcp_minervini',
    detectWithConfluence: async () => [{
      id: 'opp-1', strategyKey: 'vcp_minervini', symbol: 'AAPL',
      assetClass: 'stocks', direction: 'long', expectedReturn: 0.05,
      strength: 0.8, metadata: {},
    }],
    classifyEdge: async () => ({ edgeType: 'technical' }),
    runMiroFishConfluence: async () => null,
    runKronosConfluence: async () => null,
    runRedTeam: async () => ({ passed: true, score: 80 }),
    runRiskCheck: async () => ({ veto: false, kellyFraction: 0.03 }),
    sizePosition: async () => ({ fraction: 0.03, notionalUsd: 300, rationale: 'test' }),
    execute: async () => ({ status: 'skipped', broker: 'none', error: 'paper phase' }),
    logAudit: logAuditMock,
  }],
}))

vi.mock('@/lib/paper-trading/PaperTradeRunner', () => ({
  runPaperTradingPass: vi.fn(async () => ({
    positionsOpened: 0, positionsClosed: 0, errors: [], skipped: {},
  })),
}))

vi.mock('@/lib/strategies/profile-params', () => ({
  loadUserProfile: async () => ({ profileKey: 'balanced' }),
  getEffectiveStrategies: () => new Set(['vcp_minervini']),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const rows = table === 'user_enabled_strategies'
        ? [{ user_id: 'user-42', strategy_key: 'vcp_minervini', is_enabled: true }]
        : []
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = () => chain
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve)
      return chain
    },
  }),
}))

import { POST } from '@/app/api/internal/scan-all/route'

beforeEach(() => {
  logAuditMock.mockClear()
  vi.stubEnv('WEALTH_OS_API_KEY', 'scan-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/internal/scan-all', () => {
  it('every audit call carries the userId it ran for', async () => {
    const req = new NextRequest('http://localhost/api/internal/scan-all', {
      method: 'POST',
      headers: { authorization: 'Bearer scan-key' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)

    expect(logAuditMock).toHaveBeenCalled()
    for (const call of logAuditMock.mock.calls as unknown[][]) {
      // logAudit(opp, decision, verdicts, supabase, userId)
      expect(call[4], 'audit call missing userId').toBe('user-42')
    }
  })

  it('denies without the API key', async () => {
    const req = new NextRequest('http://localhost/api/internal/scan-all', { method: 'POST' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})
