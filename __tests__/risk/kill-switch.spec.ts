/**
 * Runtime kill switch — the pre-trade gate that was previously MISSING:
 * max_drawdown_pct and daily_loss_limit_usd were defined in risk-controls
 * but nothing enforced them at trade time, and sleeve `halted` flags were
 * never checked before order submission.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  evaluateKillSwitch,
  computeDrawdownPct,
  preTradeRiskCheck,
  type KillSwitchInputs,
} from '@/lib/risk/kill-switch'

const HAPPY: KillSwitchInputs = {
  globalHalted: false,
  sleeveHalted: false,
  drawdownPct: 5,
  maxDrawdownPct: 20,
  dailyRealizedPnlUsd: -100,
  dailyLossLimitUsd: 500,
}

describe('evaluateKillSwitch', () => {
  it('happy path passes', () => {
    expect(evaluateKillSwitch(HAPPY)).toEqual({ allowed: true })
  })

  it('drawdown breach blocks', () => {
    const r = evaluateKillSwitch({ ...HAPPY, drawdownPct: 25 })
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('max_drawdown_breached')
    expect(r.reason).toContain('25.0%')
  })

  it('drawdown exactly at the limit does not block (limit is exclusive)', () => {
    expect(evaluateKillSwitch({ ...HAPPY, drawdownPct: 20 }).allowed).toBe(true)
  })

  it('daily loss breach blocks', () => {
    const r = evaluateKillSwitch({ ...HAPPY, dailyRealizedPnlUsd: -600 })
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('daily_loss_limit_breached')
  })

  it('daily GAIN never blocks even beyond the limit magnitude', () => {
    expect(evaluateKillSwitch({ ...HAPPY, dailyRealizedPnlUsd: 9999 }).allowed).toBe(true)
  })

  it('no daily loss limit configured → loss does not block', () => {
    expect(
      evaluateKillSwitch({ ...HAPPY, dailyRealizedPnlUsd: -50_000, dailyLossLimitUsd: null }).allowed
    ).toBe(true)
  })

  it('halted sleeve blocks', () => {
    const r = evaluateKillSwitch({ ...HAPPY, sleeveHalted: true, haltedSleeveId: 'sleeve-1' })
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('sleeve_halted')
  })

  it('global trading_halted flag blocks with reason', () => {
    const r = evaluateKillSwitch({ ...HAPPY, globalHalted: true, globalHaltReason: 'manual flatten' })
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('trading_halted')
    expect(r.reason).toContain('manual flatten')
  })

  it('global halt takes priority over other reasons', () => {
    const r = evaluateKillSwitch({
      ...HAPPY,
      globalHalted: true,
      sleeveHalted: true,
      drawdownPct: 99,
    })
    expect(r.reason).toContain('trading_halted')
  })
})

describe('computeDrawdownPct', () => {
  it('computes drawdown from the high-water mark, not from the start', () => {
    // base 10k → +500 (peak 10.5k) → -800 → equity 9.7k. DD = 800/10500.
    const dd = computeDrawdownPct(10_000, [500, -800], 0)
    expect(dd).toBeCloseTo((800 / 10_500) * 100, 5)
  })

  it('includes open unrealized P&L in current equity', () => {
    const dd = computeDrawdownPct(10_000, [500, -800], -200)
    expect(dd).toBeCloseTo((1000 / 10_500) * 100, 5)
  })

  it('returns 0 at fresh highs and with no history', () => {
    expect(computeDrawdownPct(10_000, [], 0)).toBe(0)
    expect(computeDrawdownPct(10_000, [100, 200], 50)).toBe(0)
  })

  it('returns 0 for non-positive base equity instead of dividing by zero', () => {
    expect(computeDrawdownPct(0, [-100], 0)).toBe(0)
    expect(computeDrawdownPct(NaN, [-100], 0)).toBe(0)
  })
})

// ─── preTradeRiskCheck (state gathering) ─────────────────────────────────────

type Row = Record<string, unknown>

/** Chainable supabase mock: each table resolves the given rows (or an error). */
function makeSupabase(tables: Record<string, { data?: Row[] | Row | null; error?: { message: string } | null }>) {
  return {
    from: vi.fn((table: string) => {
      const res = tables[table] ?? { data: [], error: null }
      const result = { data: res.data ?? [], error: res.error ?? null }
      const builder: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) => resolve(result),
      }
      builder.select = () => builder
      builder.eq = () => builder
      builder.single = () => Promise.resolve(
        Array.isArray(result.data)
          ? { data: result.data[0] ?? null, error: result.error }
          : result
      )
      return builder
    }),
  } as never
}

describe('preTradeRiskCheck', () => {
  it('blocks when the global trading_halted flag is set', async () => {
    const supabase = makeSupabase({
      system_flags: { data: [{ user_id: null, enabled: true, reason: 'ops halt' }] },
    })
    const r = await preTradeRiskCheck({ supabase, userId: 'u1', strategyKey: 'pead' })
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('trading_halted')
  })

  it('blocks when the user own halt flag is set, ignores other users flags', async () => {
    const others = makeSupabase({
      system_flags: { data: [{ user_id: 'someone-else', enabled: true, reason: null }] },
    })
    expect((await preTradeRiskCheck({ supabase: others, userId: 'u1' })).allowed).toBe(true)

    const own = makeSupabase({
      system_flags: { data: [{ user_id: 'u1', enabled: true, reason: null }] },
    })
    expect((await preTradeRiskCheck({ supabase: own, userId: 'u1' })).allowed).toBe(false)
  })

  it('FAILS CLOSED when system_flags cannot be read (missing migration)', async () => {
    const supabase = makeSupabase({
      system_flags: { error: { message: 'relation "public.system_flags" does not exist' } },
    })
    const r = await preTradeRiskCheck({ supabase, userId: 'u1' })
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('kill_switch_unavailable')
  })

  it('blocks when a halted sleeve approves this strategy', async () => {
    const supabase = makeSupabase({
      portfolio_sleeves: { data: [{ id: 's1', halted: true, approved_strategies: ['pead'] }] },
    })
    const r = await preTradeRiskCheck({ supabase, userId: 'u1', strategyKey: 'pead' })
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('sleeve_halted')
  })

  it('a halted sleeve for a DIFFERENT strategy does not block', async () => {
    const supabase = makeSupabase({
      portfolio_sleeves: { data: [{ id: 's1', halted: true, approved_strategies: ['sector_rotation'] }] },
    })
    const r = await preTradeRiskCheck({ supabase, userId: 'u1', strategyKey: 'pead' })
    expect(r.allowed).toBe(true)
  })

  it('blocks on drawdown breach computed from recorded closes', async () => {
    // equity base $10k (assets), peak +$1k, then -$4k → DD ≈ 36% > 20% default
    const supabase = makeSupabase({
      assets: { data: [{ current_value: 10_000 }] },
      paper_positions: {
        data: [
          { closed_at: '2026-06-01T10:00:00Z', realized_pnl_usd: 1_000, status: 'closed' },
          { closed_at: '2026-06-02T10:00:00Z', realized_pnl_usd: -4_000, status: 'closed' },
        ],
      },
    })
    const r = await preTradeRiskCheck({ supabase, userId: 'u1', strategyKey: 'pead' })
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('max_drawdown_breached')
  })

  it('blocks on daily loss breach when a limit is configured', async () => {
    const today = new Date().toISOString()
    const supabase = makeSupabase({
      assets: { data: [{ current_value: 100_000 }] },
      risk_controls: {
        data: [{
          max_portfolio_risk_pct: 2, max_single_position_pct: 10, max_drawdown_pct: 20,
          stop_loss_enabled: true, daily_loss_limit_usd: 500, volatility_threshold: 'medium',
        }],
      },
      paper_positions: {
        data: [{ closed_at: today, realized_pnl_usd: -900, status: 'closed' }],
      },
    })
    const r = await preTradeRiskCheck({ supabase, userId: 'u1' })
    expect(r.allowed).toBe(false)
    expect(r.reason).toContain('daily_loss_limit_breached')
  })

  it('happy path passes with clean state', async () => {
    const supabase = makeSupabase({})
    const r = await preTradeRiskCheck({ supabase, userId: 'u1', strategyKey: 'pead' })
    expect(r).toEqual({ allowed: true })
  })
})
