/**
 * Item 7 — strategy attribution (empty / partial / complete states; nothing
 * fabricated). Item 5 — broker certification matrix: certification data
 * NEVER flips liveReady.
 */

import { describe, it, expect } from 'vitest'
import { computeAttribution, type AttributionTrade } from '@/lib/paper-trading/attribution'
import {
  buildReadinessMatrix,
  certificationStatusOf,
  CERTIFICATION_CHECKS,
  type CertificationRow,
} from '@/lib/paper-trading/broker-certification'

// ─── attribution ──────────────────────────────────────────────────────────────

const trade = (over: Partial<AttributionTrade> = {}): AttributionTrade => ({
  returnPct: 0.02, notionalUsd: 1_000, exitReason: 'take_profit',
  closedAt: '2026-06-01T00:00:00Z', ...over,
})

describe('computeAttribution (item 7)', () => {
  it('empty history → every component says "not enough data"', () => {
    const a = computeAttribution({
      strategyKey: 'x', trades: [], entrySlipsBps: [], exitSlipsBps: [], shadowReturnsPct: [],
    })
    expect(a.sample).toBe(0)
    for (const comp of [a.costDrag, a.exitContribution, a.sizingContribution, a.regimeContribution, a.vetoBenefit, a.residual]) {
      expect(comp.valuePct).toBeNull()
      expect(comp.note.toLowerCase()).toContain('not enough data')
    }
  })

  it('partial data → computed components computed, missing ones honest', () => {
    const trades = [
      trade({ returnPct: 0.03 }), trade({ returnPct: -0.01, exitReason: 'stop_loss' }),
      trade({ returnPct: 0.02 }), trade({ returnPct: 0.01 }), trade({ returnPct: -0.02, exitReason: 'stop_loss' }),
    ]
    const a = computeAttribution({
      strategyKey: 'x', trades,
      entrySlipsBps: [5, 5, 5, 5, 5], exitSlipsBps: [10, 10, 10, 10, 10],
      shadowReturnsPct: [],   // no shadow data
    })
    expect(a.costDrag.valuePct).toBeCloseTo(-0.15, 5)   // (5+10)bps → −0.15%
    expect(a.sizingContribution.valuePct).toBe(0)       // equal notionals → no sizing effect
    expect(a.vetoBenefit.valuePct).toBeNull()           // not fabricated
    expect(a.regimeContribution.valuePct).toBeNull()    // no regimes recorded
    expect(a.exitBreakdown.find(x => x.reason === 'stop_loss')?.count).toBe(2)
    expect(a.residual.valuePct).not.toBeNull()
  })

  it('complete data → sizing, veto, regime, exit, and residual all real numbers', () => {
    const trades = [
      trade({ returnPct: 0.05, notionalUsd: 4_000, regime: 'risk_on' }),
      trade({ returnPct: 0.01, notionalUsd: 500, regime: 'risk_on' }),
      trade({ returnPct: -0.02, notionalUsd: 500, exitReason: 'stop_loss', regime: 'risk_off' }),
      trade({ returnPct: 0.03, notionalUsd: 3_000, regime: 'risk_on' }),
      trade({ returnPct: 0.02, notionalUsd: 2_000, regime: 'risk_on' }),
    ]
    const a = computeAttribution({
      strategyKey: 'x', trades,
      entrySlipsBps: [4, 4, 4, 4, 4], exitSlipsBps: [8, 8, 8, 8, 8],
      shadowReturnsPct: [-0.02, -0.03, 0.01, -0.04, -0.01],
      drawdownOverlapMax: 0.8,
    })
    // Big positions did better → positive sizing contribution.
    expect(a.sizingContribution.valuePct).toBeGreaterThan(0)
    // Vetoed trades lost on average → positive veto benefit.
    expect(a.vetoBenefit.valuePct).toBeGreaterThan(0)
    expect(a.regimeContribution.valuePct).not.toBeNull()
    expect(a.exitContribution.valuePct).not.toBeNull()
    expect(a.residual.valuePct).not.toBeNull()
    expect(a.synergyEffect.note).toContain('80%')
  })
})

// ─── broker certification (item 5) ────────────────────────────────────────────

function cert(over: Partial<CertificationRow> = {}): CertificationRow {
  return {
    broker: 'alpaca', environment: 'sandbox',
    tested_order_placement: true, tested_cancel: true, tested_status: true,
    tested_partial_fill: true, tested_rejection: true, tested_bracket_oco: true,
    tested_reconciliation: true, tested_quantity_conversion: true,
    evidence_notes: 'sandbox run 2026-07-01', certified_by: 'operator',
    certified_at: '2026-07-01T00:00:00Z', expires_at: null,
    ...over,
  }
}

const adapters = [
  { id: 'alpaca', displayName: 'Alpaca', configured: true, liveReady: false },
  { id: 'oanda', displayName: 'OANDA', configured: false, liveReady: false },
]

describe('broker certification matrix (item 5)', () => {
  it('no certification → not_certified, liveReady stays false', () => {
    const rows = buildReadinessMatrix(adapters, [])
    expect(rows.every(r => r.status === 'not_certified')).toBe(true)
    expect(rows.every(r => r.liveReady === false)).toBe(true)
    expect(rows[0].checksPassed).toBe(0)
    expect(rows[0].checksTotal).toBe(CERTIFICATION_CHECKS.length)
  })

  it('a FULL certification does NOT flip liveReady — that is a code change', () => {
    const rows = buildReadinessMatrix(adapters, [cert()])
    const alpaca = rows.find(r => r.broker === 'alpaca')!
    expect(alpaca.status).toBe('certified_sandbox')
    expect(alpaca.checksPassed).toBe(8)
    expect(alpaca.liveReady).toBe(false)   // THE invariant
  })

  it('partial checks → in_progress; expiry → expired', () => {
    expect(certificationStatusOf(cert({ tested_reconciliation: false, certified_at: null })).status)
      .toBe('in_progress')
    expect(certificationStatusOf(cert({ expires_at: '2026-01-01T00:00:00Z' }), new Date('2026-07-01')).status)
      .toBe('expired')
  })

  it('missing certified_by/at keeps a fully-checked row out of certified status', () => {
    expect(certificationStatusOf(cert({ certified_by: null })).status).toBe('in_progress')
  })
})
