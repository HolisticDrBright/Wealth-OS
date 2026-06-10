/**
 * Tests for lib/tax/wash-sale-guard.ts
 * Blocklist lookups and the IRC §1091 cost-basis adjustment.
 */
import { describe, it, expect } from 'vitest'
import {
  checkWashSaleBlocklist,
  computeWashSaleAdjustment,
  WASH_SALE_BLOCK_DAYS,
} from '@/lib/tax/wash-sale-guard'

// ─── Mock supabase chain ──────────────────────────────────

function mockSupabase(rows: Array<{ symbol: string; blocked_until: string; loss_amount_usd: number }> | null, error: unknown = null) {
  const result = Promise.resolve({ data: rows, error })
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    order: () => chain,
    limit: () => result,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => chain } as any
}

describe('checkWashSaleBlocklist', () => {
  it('returns blocked with reason and blockedUntil when an active row exists', async () => {
    const blockedUntil = new Date(Date.now() + 10 * 86400_000).toISOString()
    const supabase = mockSupabase([{ symbol: 'SPY', blocked_until: blockedUntil, loss_amount_usd: 1200 }])

    const r = await checkWashSaleBlocklist(supabase, 'user-1', 'spy')
    expect(r.blocked).toBe(true)
    expect(r.blockedUntil).toBe(blockedUntil)
    expect(r.reason).toContain('SPY')
    expect(r.reason).toContain('wash sale')
  })

  it('returns not blocked when no rows match', async () => {
    const r = await checkWashSaleBlocklist(mockSupabase([]), 'user-1', 'AAPL')
    expect(r).toEqual({ blocked: false })
  })

  it('fails open on infrastructure errors', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const broken = { from: () => { throw new Error('connection refused') } } as any
    const r = await checkWashSaleBlocklist(broken, 'user-1', 'AAPL')
    expect(r.blocked).toBe(false)
  })

  it('block window constant covers sale day plus 30-day window', () => {
    expect(WASH_SALE_BLOCK_DAYS).toBe(31)
  })
})

describe('computeWashSaleAdjustment', () => {
  it('full repurchase inside window disallows the entire loss and bumps basis', () => {
    const r = computeWashSaleAdjustment({
      sharesSoldAtLoss: 100,
      totalLossUsd: 1000,
      saleDate: '2026-06-01',
      replacementShares: 100,
      replacementCostPerShare: 40,
      replacementAcquiredDate: '2026-06-10',
    })
    expect(r.isWashSale).toBe(true)
    expect(r.matchedShares).toBe(100)
    expect(r.disallowedLossUsd).toBe(1000)
    expect(r.allowedLossUsd).toBe(0)
    // 100 * 40 + 1000 = 5000 → 50/share
    expect(r.adjustedTotalBasisUsd).toBe(5000)
    expect(r.adjustedCostPerShare).toBe(50)
  })

  it('partial repurchase disallows only the matched proportion', () => {
    const r = computeWashSaleAdjustment({
      sharesSoldAtLoss: 100,
      totalLossUsd: 1000,
      saleDate: '2026-06-01',
      replacementShares: 40,
      replacementCostPerShare: 40,
      replacementAcquiredDate: '2026-06-15',
    })
    expect(r.isWashSale).toBe(true)
    expect(r.matchedShares).toBe(40)
    expect(r.disallowedLossUsd).toBe(400)
    expect(r.allowedLossUsd).toBe(600)
    // 40 * 40 + 400 = 2000 → 50/share
    expect(r.adjustedCostPerShare).toBe(50)
  })

  it('repurchase before the sale (30 days prior) also triggers a wash sale', () => {
    const r = computeWashSaleAdjustment({
      sharesSoldAtLoss: 10,
      totalLossUsd: 200,
      saleDate: '2026-06-01',
      replacementShares: 10,
      replacementCostPerShare: 20,
      replacementAcquiredDate: '2026-05-15',
    })
    expect(r.isWashSale).toBe(true)
    expect(r.disallowedLossUsd).toBe(200)
  })

  it('repurchase outside the 30-day window is not a wash sale', () => {
    const r = computeWashSaleAdjustment({
      sharesSoldAtLoss: 100,
      totalLossUsd: 1000,
      saleDate: '2026-06-01',
      replacementShares: 100,
      replacementCostPerShare: 40,
      replacementAcquiredDate: '2026-07-15', // 44 days later
    })
    expect(r.isWashSale).toBe(false)
    expect(r.disallowedLossUsd).toBe(0)
    expect(r.allowedLossUsd).toBe(1000)
    expect(r.adjustedCostPerShare).toBe(40)
  })

  it('a gain (totalLossUsd <= 0) never produces an adjustment', () => {
    const r = computeWashSaleAdjustment({
      sharesSoldAtLoss: 100,
      totalLossUsd: 0,
      saleDate: '2026-06-01',
      replacementShares: 100,
      replacementCostPerShare: 40,
      replacementAcquiredDate: '2026-06-05',
    })
    expect(r.isWashSale).toBe(false)
    expect(r.disallowedLossUsd).toBe(0)
  })
})
