/**
 * Core / Safety trade planning (Phase 3) — PURE. Decides WHAT to buy or sell;
 * lib/allocation/core-trading.ts executes it. Nothing here trades.
 *
 *   planLadderSetup   the one-tap setup: Tier 1 shortfall into the cash-like
 *                     fund, then each Core fund up to its target.
 *   planDeposit       new money fills Tier 1 first, then Core — the fund
 *                     furthest below target first.
 *   coreDrift         how far Core's stock / bond shares sit from target.
 *   planCoreRebalance self-funded sells of overweight funds and buys of
 *                     underweight ones, back to target weights.
 */

import { CORE_FUNDS } from '@/lib/config/product-defaults'
import { CORE_DRIFT_THRESHOLD, CORE_MIN_TRADE_USD } from '@/lib/config/product-defaults'
import { freeUsd, type Ladder, type CoreFundView } from '@/lib/allocation/ladder'
import type { LadderSleeve } from '@/lib/allocation/sleeves'
import { oneWayCostBps } from '@/lib/costs/transaction-costs'

/** Fund ETFs price and cost like stocks. */
export const FUND_COST_CLASS = 'stocks'

export interface FundTrade {
  sleeve: LadderSleeve
  symbol: string
  side: 'buy' | 'sell'
  usd: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Dollars to spend on the cash-like fund so that, AFTER the purchase cost,
 * Tier 1 holds at least `shortfall` (a buy of exactly the shortfall would land
 * a few dollars short and keep Explore shut). Never below the minimum trade.
 */
export function safetyBuyFor(shortfallUsd: number): number {
  if (!(shortfallUsd > 0.005)) return 0
  const gross = Math.ceil(shortfallUsd * (1 + oneWayCostBps(FUND_COST_CLASS) / 10_000) * 100) / 100
  return Math.max(CORE_MIN_TRADE_USD, gross)
}

/** Funds ordered furthest-below-target first (largest dollar gap first). */
function byGap(funds: CoreFundView[]): Array<CoreFundView & { gapUsd: number }> {
  return funds
    .map(f => ({ ...f, gapUsd: Math.max(0, f.targetUsd - f.heldUsd) }))
    .sort((a, b) => b.gapUsd - a.gapUsd)
}

/**
 * Spend `budget` on Core: largest gap first, each fund up to its target; any
 * money left after every gap is filled is split by target weight.
 */
export function allocateToCore(funds: CoreFundView[], budget: number): FundTrade[] {
  const out = new Map<string, number>()
  let left = Math.max(0, budget)
  for (const f of byGap(funds)) {
    if (left <= 0) break
    const buy = Math.min(f.gapUsd, left)
    if (buy > 0) { out.set(f.symbol, (out.get(f.symbol) ?? 0) + buy); left -= buy }
  }
  if (left > 0) {
    for (const f of funds) {
      if (f.weight > 0) out.set(f.symbol, (out.get(f.symbol) ?? 0) + left * f.weight)
    }
  }
  return [...out.entries()]
    .filter(([, usd]) => usd >= CORE_MIN_TRADE_USD)
    .map(([symbol, usd]) => ({ sleeve: 'core' as const, symbol, side: 'buy' as const, usd: r2(usd) }))
}

/**
 * The one-tap ladder setup. Fills Tier 1 first; Core is only bought from money
 * left once Tier 1 is covered (safest money first).
 */
export function planLadderSetup(ladder: Ladder): FundTrade[] {
  if (ladder.tier1.status === 'needs_expenses' || ladder.tier1.targetUsd == null) return []
  const trades: FundTrade[] = []
  const needed = safetyBuyFor(ladder.tier1.shortfallUsd)
  const free = freeUsd(ladder)
  const tier1Buy = r2(Math.min(needed, free))
  if (tier1Buy >= 0.01) {
    trades.push({ sleeve: 'safety', symbol: CORE_FUNDS.cashLike, side: 'buy', usd: tier1Buy })
  }
  // Core is invested only when Tier 1 will be full after this setup, and only
  // with money that is really there: free money left after the Tier 1 buy,
  // plus recorded cash beyond the Tier 1 target (never the cash-like fund).
  if (tier1Buy + 0.005 >= needed) {
    const cashCounted = Math.max(0, ladder.tier1.heldUsd - ladder.tier1.inFundUsd)
    const excessCash = Math.min(cashCounted, Math.max(0, ladder.tier1.heldUsd + tier1Buy - ladder.tier1.targetUsd))
    let budget = Math.max(0, free - tier1Buy) + excessCash
    for (const f of byGap(ladder.core.funds)) {
      const buy = Math.min(f.gapUsd, budget)
      if (buy < CORE_MIN_TRADE_USD) continue
      trades.push({ sleeve: 'core', symbol: f.symbol, side: 'buy', usd: r2(buy) })
      budget -= buy
    }
  }
  return trades
}

/**
 * True when the one-tap setup has something to do: Tier 1 is short, Core has
 * never been bought, or Core sits more than CORE_DRIFT_THRESHOLD of its
 * target below it (e.g. new money was recorded).
 */
export function setupNeeded(ladder: Ladder): boolean {
  if (planLadderSetup(ladder).length === 0) return false
  if (ladder.tier1.status === 'short' || !ladder.core.invested) return true
  const gap = ladder.core.funds.reduce((s, f) => s + Math.max(0, f.targetUsd - f.heldUsd), 0)
  return ladder.core.targetUsd > 0 && gap > CORE_DRIFT_THRESHOLD * ladder.core.targetUsd
}

export interface DepositPlan {
  tier1Usd: number
  coreUsd: number
  trades: FundTrade[]
}

/** New money: Tier 1 shortfall first, then Core, furthest-below-target fund first. */
export function planDeposit(ladder: Ladder, amountUsd: number): DepositPlan {
  const amount = Math.max(0, amountUsd)
  const needed = ladder.tier1.status === 'needs_expenses' ? 0 : safetyBuyFor(ladder.tier1.shortfallUsd)
  const tier1Usd = r2(Math.min(amount, needed))
  const coreUsd = r2(amount - tier1Usd)
  const trades: FundTrade[] = []
  if (tier1Usd >= 0.01) {
    trades.push({ sleeve: 'safety', symbol: CORE_FUNDS.cashLike, side: 'buy', usd: tier1Usd })
  }
  trades.push(...allocateToCore(ladder.core.funds, coreUsd))
  return { tier1Usd: r2(tier1Usd), coreUsd: r2(coreUsd), trades }
}

export interface CoreDrift {
  /** Core's stock share as held (null when Core holds nothing). */
  heldStockShare: number | null
  targetStockShare: number
  /** held − target, as a fraction (+0.06 = 6 points overweight stocks). */
  driftStock: number
  needsRebalance: boolean
}

export function coreDrift(ladder: Ladder): CoreDrift {
  const held = ladder.core.funds.reduce((s, f) => s + f.heldUsd, 0)
  const target = ladder.core.stockShare
  if (!ladder.core.invested || held <= 0) {
    return { heldStockShare: null, targetStockShare: target, driftStock: 0, needsRebalance: false }
  }
  const stocks = ladder.core.funds.filter(f => f.assetClass === 'stock').reduce((s, f) => s + f.heldUsd, 0)
  const heldStockShare = stocks / held
  const driftStock = heldStockShare - target
  return {
    heldStockShare,
    targetStockShare: target,
    driftStock,
    // Stocks and bonds are the only Core classes, so the bond drift is the
    // mirror image — one check covers both.
    needsRebalance: Math.abs(driftStock) > CORE_DRIFT_THRESHOLD,
  }
}

/**
 * Self-funded rebalance back to target weights on the CURRENT Core value:
 * sells of overweight funds pay for buys of underweight ones.
 */
export function planCoreRebalance(ladder: Ladder): FundTrade[] {
  const held = ladder.core.funds.reduce((s, f) => s + f.heldUsd, 0)
  if (held <= 0) return []
  const trades: FundTrade[] = []
  for (const f of ladder.core.funds) {
    const delta = held * f.weight - f.heldUsd
    if (Math.abs(delta) < CORE_MIN_TRADE_USD) continue
    trades.push({ sleeve: 'core', symbol: f.symbol, side: delta > 0 ? 'buy' : 'sell', usd: r2(Math.abs(delta)) })
  }
  // Sells first so the buys are funded by them.
  return trades.sort((a, b) => (a.side === b.side ? 0 : a.side === 'sell' ? -1 : 1))
}
