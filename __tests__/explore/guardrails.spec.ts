/**
 * Phase 4.3–4.4 — approval-before-automation + copy-trading guardrails.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  PAPER_COPY_PERIOD_DAYS, COPY_DELAY_HAIRCUT_FRACTION, MIN_ACTUAL_COPIES,
  estimatedCopierResultPct, copierResultFor, swingLabelOf,
  riskAdjustedSortKey, practiceRunProgress,
} from '@/lib/explore/copier-results'

describe('copier-adjusted results', () => {
  it('the estimate is always below a positive headline (delay + costs)', () => {
    for (const assetClass of ['stock', 'crypto', 'forex', 'polymarket']) {
      const est = estimatedCopierResultPct({ headlineReturnPct: 20, assetClass, tradeCount: 50 })
      expect(est).toBeLessThan(20)
    }
  })

  it('more trading means more cost drag', () => {
    const light = estimatedCopierResultPct({ headlineReturnPct: 20, assetClass: 'stock', tradeCount: 10 })
    const heavy = estimatedCopierResultPct({ headlineReturnPct: 20, assetClass: 'stock', tradeCount: 200 })
    expect(heavy).toBeLessThanOrEqual(light)
  })

  it('uses REAL copied-trade results when enough exist, labeled as actual', () => {
    const r = copierResultFor({
      headlineReturnPct: 18, assetClass: 'stock', tradeCount: 30,
      actualCopyPnlPcts: [2, -1, 3, 1, 0.5],
    })
    expect(r.isEstimate).toBe(false)
    expect(r.copierPct).toBeCloseTo((2 - 1 + 3 + 1 + 0.5) / 5, 1)
    expect(r.explanation).toContain('your real copied trades')
  })

  it('falls back to a labeled estimate with fewer real copies', () => {
    const r = copierResultFor({
      headlineReturnPct: 18, assetClass: 'stock', tradeCount: 30,
      actualCopyPnlPcts: [2],
    })
    expect(r.isEstimate).toBe(true)
    expect(r.explanation).toContain('Estimate')
    expect(MIN_ACTUAL_COPIES).toBeGreaterThan(1)
  })

  it('named constants exist with sane values', () => {
    expect(PAPER_COPY_PERIOD_DAYS).toBe(30)
    expect(COPY_DELAY_HAIRCUT_FRACTION).toBeGreaterThan(0)
    expect(COPY_DELAY_HAIRCUT_FRACTION).toBeLessThan(1)
  })
})

describe('swings + ranking', () => {
  it('crypto and prediction markets are bigger swings; stocks and forex lower', () => {
    expect(swingLabelOf('crypto')).toBe('bigger')
    expect(swingLabelOf('polymarket')).toBe('bigger')
    expect(swingLabelOf('stock')).toBe('lower')
    expect(swingLabelOf('forex')).toBe('lower')
  })

  it('the simple-mode sort key discounts bigger-swing markets, never raw return', () => {
    // Same copier result: the lower-swing trader ranks higher.
    expect(riskAdjustedSortKey(12, 'stock')).toBeGreaterThan(riskAdjustedSortKey(12, 'crypto'))
    // A big raw headline in crypto does NOT beat a modest stock result purely on size.
    expect(riskAdjustedSortKey(10, 'stock')).toBeGreaterThan(riskAdjustedSortKey(18, 'crypto'))
  })
})

describe('practice run (30-day paper-copy period)', () => {
  const now = new Date('2026-11-18T12:00:00Z')

  it('day 1 right after following; not complete', () => {
    const r = practiceRunProgress('2026-11-18T09:00:00Z', now)!
    expect(r.dayN).toBe(1)
    expect(r.complete).toBe(false)
  })

  it('day 12 mid-run', () => {
    const r = practiceRunProgress('2026-11-07T09:00:00Z', now)!
    expect(r.dayN).toBe(12)
    expect(r.complete).toBe(false)
  })

  it('complete only after the full period', () => {
    const notYet = practiceRunProgress('2026-10-20T12:00:00Z', now)!   // day 30
    expect(notYet.complete).toBe(false)
    const done = practiceRunProgress('2026-10-18T09:00:00Z', now)!     // day 32
    expect(done.complete).toBe(true)
  })

  it('null/garbage input gives null (callers fail closed)', () => {
    expect(practiceRunProgress(null)).toBeNull()
    expect(practiceRunProgress('not-a-date')).toBeNull()
  })
})

// ─── Write-path contracts ────────────────────────────────────────────────────

const read = (p: string) => readFileSync(join(process.cwd(), ...p.split('/')), 'utf8')

describe('approval before automation (simple mode)', () => {
  it('followTrader requires a recorded approval in simple mode', () => {
    const src = read('lib/actions/traders.ts')
    expect(src).toContain('approvalRequired()')
    expect(src).toContain("kind: 'follow_trader'")
    expect(src).toMatch(/approval_required/)
  })

  it('auto-copy is locked behind the practice run in EVERY mode', () => {
    const src = read('lib/actions/traders.ts')
    const gate = src.indexOf('practiceRunProgress')
    const write = src.indexOf("from('user_followed_traders')\n    .update", gate)
    expect(gate).toBeGreaterThan(-1)
    expect(src).toContain('practice_run_incomplete')
    expect(write).toBeGreaterThan(gate)
  })

  it('enabling a strategy requires approval in simple mode and records it', () => {
    const src = read('app/api/users/me/strategies/route.ts')
    expect(src).toContain('approval_required')
    expect(src).toContain("kind: 'enable_strategy'")
  })

  it('executing a rebalance requires approval in simple mode and records it', () => {
    const src = read('app/api/rebalance/route.ts')
    expect(src).toContain('approval_required')
    expect(src).toContain("kind: 'accept_rebalance'")
  })
})

describe('traders UI guardrails', () => {
  it('shows both figures, labeled, with the copier result emphasized', () => {
    const src = read('app/(app)/traders/traders-client.tsx')
    expect(src).toContain('Their result (headline)')
    expect(src).toContain('What a copier got')
    expect(src).toContain('emphasized')
    expect(src).toContain('Practice run: day')
  })

  it('simple mode sorts by the adjusted key server-side, never raw return', () => {
    const src = read('lib/actions/explore.ts')
    expect(src).toContain('riskAdjustedSortKey')
    expect(src).toMatch(/uiMode === 'simple'/)
  })
})
