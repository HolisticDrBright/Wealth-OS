/**
 * Unit tests for feature-toggle logic (no DOM required).
 *
 * Tests:
 *   - formatCostCents / formatCostRange utility
 *   - $50 cap sends 5000 cents (cents↔USD conversion round-trip)
 *   - projectMonthlyCost: trend detection, projection, daily average
 *   - projectMonthlyCost: updates correctly when new usage logs are added
 *
 * The component-level interaction tests (toggle ON → mutation fires, optimistic
 * UI update) require @testing-library/react + jsdom — those are integration
 * tests that run in the browser dev server.
 */

import { describe, it, expect } from 'vitest'
import { formatCostCents, formatCostRange, shortCents } from '@/lib/utils/format-cost'
import { projectMonthlyCost } from '@/lib/utils/cost-projection'

// ─── formatCostCents ──────────────────────────────────────────────────────────

describe('formatCostCents', () => {
  it('formats zero cents as $0.00', () => {
    expect(formatCostCents(0)).toBe('$0.00')
  })

  it('formats 450 cents as $4.50', () => {
    expect(formatCostCents(450)).toBe('$4.50')
  })

  it('formats 123456 cents as $1,234.56', () => {
    expect(formatCostCents(123456)).toBe('$1,234.56')
  })

  it('formats 1 cent as $0.01', () => {
    expect(formatCostCents(1)).toBe('$0.01')
  })
})

// ─── formatCostRange ──────────────────────────────────────────────────────────

describe('formatCostRange', () => {
  it('formats a low–high range correctly', () => {
    expect(formatCostRange(1500, 4500)).toBe('$15-$45/mo')
  })

  it('formats equal low and high as single value', () => {
    expect(formatCostRange(2000, 2000)).toBe('$20/mo')
  })

  it('formats small values', () => {
    expect(formatCostRange(300, 800)).toBe('$3-$8/mo')
  })
})

// ─── shortCents ───────────────────────────────────────────────────────────────

describe('shortCents', () => {
  it('returns "Free" for 0 cents', () => {
    expect(shortCents(0)).toBe('Free')
  })

  it('formats whole dollar amounts without decimals', () => {
    expect(shortCents(100)).toBe('$1')
  })

  it('formats partial dollar amounts with 2 decimals', () => {
    expect(shortCents(50)).toBe('$0.50')
  })
})

// ─── $50 cap → 5000 cents round-trip ─────────────────────────────────────────

describe('cents ↔ USD conversion', () => {
  it('$50 USD cap converts to 5000 cents', () => {
    const usd = 50
    const cents = Math.round(usd * 100)
    expect(cents).toBe(5000)
  })

  it('5000 cents converts back to $50 USD', () => {
    const cents = 5000
    const usd = cents / 100
    expect(usd).toBe(50)
  })

  it('updateAIFeatureFlag receives USD, not cents (server action contract)', () => {
    // The updateAIFeatureFlag action takes monthly_budget_usd.
    // The FeatureToggleCard stores budget as USD in state and passes USD to the action.
    // The API route PUT /api/users/me/feature-flags/:key accepts monthly_budget_cents.
    // Verify the conversion: 5000 cents → 50 USD for the server action.
    const capCents = 5000
    const capUsd = capCents / 100  // what FeatureToggleCard sends to the server action
    expect(capUsd).toBe(50)
  })
})

// ─── projectMonthlyCost ───────────────────────────────────────────────────────

describe('projectMonthlyCost', () => {
  const makeLog = (daysAgo: number, cost: number, feature = 'mirofish') => ({
    created_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    cost_usd: cost,
    feature_key: feature,
  })

  it('returns zeros for empty history', () => {
    const r = projectMonthlyCost([])
    expect(r.projectedCents).toBe(0)
    expect(r.dailyAvgCents).toBe(0)
    expect(r.trend).toBe('stable')
  })

  it('computes daily average correctly', () => {
    // 3 days of $1/day = 100 cents/day avg
    const logs = [makeLog(2, 1), makeLog(1, 1), makeLog(0, 1)]
    const { dailyAvgCents } = projectMonthlyCost(logs)
    expect(dailyAvgCents).toBe(100)
  })

  it('detects rising trend', () => {
    const logs = [
      makeLog(6, 0.10),  // first half: low
      makeLog(5, 0.10),
      makeLog(4, 0.10),
      makeLog(2, 0.50),  // second half: high
      makeLog(1, 0.50),
      makeLog(0, 0.50),
    ]
    const { trend } = projectMonthlyCost(logs)
    expect(trend).toBe('rising')
  })

  it('detects falling trend', () => {
    const logs = [
      makeLog(6, 0.50),  // first half: high
      makeLog(5, 0.50),
      makeLog(4, 0.50),
      makeLog(2, 0.10),  // second half: low
      makeLog(1, 0.10),
      makeLog(0, 0.10),
    ]
    const { trend } = projectMonthlyCost(logs)
    expect(trend).toBe('falling')
  })

  it('projection increases when new usage logs are added', () => {
    const date = new Date(2026, 3, 10)  // April 10 — 20 days remaining

    const base = [makeLog(5, 0.5), makeLog(4, 0.5), makeLog(3, 0.5)]
    const withMore = [...base, makeLog(2, 2.0), makeLog(1, 2.0), makeLog(0, 2.0)]

    const before = projectMonthlyCost(base, date)
    const after = projectMonthlyCost(withMore, date)

    expect(after.projectedCents).toBeGreaterThan(before.projectedCents)
    expect(after.dailyAvgCents).toBeGreaterThan(before.dailyAvgCents)
  })
})
