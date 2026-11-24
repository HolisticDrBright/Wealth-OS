/**
 * Phase 4.1–4.2 — Core/Explore sleeves + the Explore cap.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  DEFAULT_EXPLORE_CAP_FRACTION, EXPLORE_CAP_HARD_MAX_FRACTION,
  clampExploreCapFraction, exploreCapVerdict,
  type ExploreUsage,
} from '@/lib/explore/cap'

function usage(over: Partial<ExploreUsage> = {}): ExploreUsage {
  const totalValueUsd = over.totalValueUsd ?? 50_000
  const capFraction = over.capFraction ?? DEFAULT_EXPLORE_CAP_FRACTION
  const capUsd = over.capUsd ?? capFraction * totalValueUsd
  const usedUsd = over.usedUsd ?? 0
  return {
    capFraction, totalValueUsd, baseUsd: totalValueUsd, capUsd, usedUsd,
    leftUsd: Math.max(0, capUsd - usedUsd), tier1Funded: true, closedReason: null,
    ...over,
  }
}

describe('clampExploreCapFraction', () => {
  it('defaults to 10% and hard-caps at the named maximum', () => {
    expect(DEFAULT_EXPLORE_CAP_FRACTION).toBe(0.10)
    expect(clampExploreCapFraction(null)).toBe(DEFAULT_EXPLORE_CAP_FRACTION)
    expect(clampExploreCapFraction(undefined)).toBe(DEFAULT_EXPLORE_CAP_FRACTION)
    expect(clampExploreCapFraction(0.5)).toBe(EXPLORE_CAP_HARD_MAX_FRACTION)
    expect(clampExploreCapFraction(0.99)).toBe(EXPLORE_CAP_HARD_MAX_FRACTION)
    expect(clampExploreCapFraction(-1)).toBe(DEFAULT_EXPLORE_CAP_FRACTION)
    expect(clampExploreCapFraction(0.15)).toBe(0.15)
  })

  it('the hard max is a real ceiling, not a suggestion', () => {
    expect(EXPLORE_CAP_HARD_MAX_FRACTION).toBeLessThanOrEqual(0.25)
  })
})

describe('exploreCapVerdict', () => {
  it('allows an order inside the cap', () => {
    // cap $5,000, used $2,900 → a $2,000 order fits
    const v = exploreCapVerdict(usage({ usedUsd: 2_900 }), 2_000)
    expect(v.allowed).toBe(true)
  })

  it('blocks an order that would breach the cap, with a dollar reason', () => {
    const v = exploreCapVerdict(usage({ usedUsd: 2_900 }), 2_200)
    expect(v.allowed).toBe(false)
    expect(v.reason).toContain('explore_cap')
    expect(v.reason).toContain('10%')
  })

  it('blocks everything when no portfolio value is recorded (cap = $0)', () => {
    const v = exploreCapVerdict(usage({ totalValueUsd: 0, capUsd: 0 }), 100)
    expect(v.allowed).toBe(false)
    expect(v.reason).toContain('no recorded portfolio value')
  })

  it('a zero-notional order is never blocked', () => {
    expect(exploreCapVerdict(usage({ totalValueUsd: 0, capUsd: 0 }), 0).allowed).toBe(true)
  })
})

// ─── Enforcement wiring (source contracts) ──────────────────────────────────

const read = (p: string) => readFileSync(join(process.cwd(), ...p.split('/')), 'utf8')

describe('explore cap is enforced in the pre-trade path and logged', () => {
  it('the paper runner checks the cap BEFORE filling, and logs blocks', () => {
    const src = read('lib/paper-trading/PaperTradeRunner.ts')
    // Phase 4: the runner loads usage once (for the risk ceiling) and applies
    // the same pure verdict exploreCapAllows wraps.
    const gateIdx = src.indexOf('exploreCapVerdict(usage')
    const fillIdx = src.indexOf('broker.fill(')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeLessThan(fillIdx)
    expect(src).toContain('logExploreCapBlock')
    expect(src).toContain('exploreCapBlocked')
  })

  it('the copy-trade executor checks the cap before the broker call, and logs blocks', () => {
    const src = read('lib/workers/copy-trade-executor.ts')
    const gateIdx = src.indexOf('exploreCapAllows(')
    const execIdx = src.indexOf('adapter.execute(')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeLessThan(execIdx)
    expect(src).toContain('logExploreCapBlock')
  })

  it('blocks are logged like other blocks (audit_logs decision=block)', () => {
    const src = read('lib/explore/cap.ts')
    expect(src).toContain("from('audit_logs')")
    expect(src).toContain("decision: 'block'")
    expect(src).toContain("'explore_cap'")
    expect(src).toContain("'tier1_gate'")
    expect(src).toContain('blocked_by:')
  })
})
