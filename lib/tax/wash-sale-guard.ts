/**
 * Wash-sale enforcement (IRC §1091).
 *
 * Detection lives in lib/wash-sale-checker.ts. This module *enforces* the
 * rule after a harvest:
 *
 *  1. `addToWashSaleBlocklist`  — called when a harvest is executed; records
 *     the symbol in `wash_sale_blocklist` with a 31-day block window
 *     (sale day + the full 30-day post-sale window).
 *  2. `checkWashSaleBlocklist`  — consulted by the rebalance suggestion flow
 *     before suggesting a BUY; blocked symbols are flagged/excluded.
 *  3. `computeWashSaleAdjustment` — pure cost-basis math: if a repurchase
 *     happens inside the window anyway, the disallowed loss is added to the
 *     replacement lot's cost basis (and the holding period of the sold
 *     shares tacks onto the replacement shares).
 */

export const WASH_SALE_WINDOW_DAYS = 30
/** Block buys for sale day + full 30-day post-sale window. */
export const WASH_SALE_BLOCK_DAYS = 31

const DAY_MS = 24 * 60 * 60 * 1000

// Minimal structural type so the guard works with the server client,
// the admin client, and test mocks alike. Deliberately loose — fully
// typed supabase clients cause excessively deep generic instantiation here.
interface SupabaseLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any
}

interface BlocklistRow {
  symbol: string
  blocked_until: string
  loss_amount_usd: number
}

export interface BlocklistCheckResult {
  blocked: boolean
  blockedUntil?: string
  reason?: string
}

/**
 * Check whether buying `symbol` is currently blocked by an active
 * wash-sale window from a prior harvested loss.
 */
export async function checkWashSaleBlocklist(
  supabase: SupabaseLike,
  userId: string,
  symbol: string
): Promise<BlocklistCheckResult> {
  try {
    const nowIso = new Date().toISOString()
    const { data } = (await supabase
      .from('wash_sale_blocklist')
      .select('symbol, blocked_until, loss_amount_usd')
      .eq('user_id', userId)
      .eq('symbol', symbol.toUpperCase())
      .eq('status', 'active')
      .gte('blocked_until', nowIso)
      .order('blocked_until', { ascending: false })
      .limit(1)) as { data: BlocklistRow[] | null }

    const row = data?.[0]
    if (!row) return { blocked: false }

    return {
      blocked: true,
      blockedUntil: row.blocked_until,
      reason: `${symbol.toUpperCase()} was sold at a loss ($${Math.abs(row.loss_amount_usd).toLocaleString()}) — repurchasing before ${new Date(row.blocked_until).toLocaleDateString()} would trigger a wash sale and disallow the loss`,
    }
  } catch {
    // Fail open on infrastructure errors — this guard informs suggestions,
    // it must never crash the rebalance flow.
    return { blocked: false }
  }
}

export interface BlocklistEntry {
  symbol: string
  assetClass: string
  lossAmountUsd: number
  /** ISO timestamp of the loss sale; defaults to now */
  harvestedAt?: string
}

/**
 * Record a harvested loss so future buys of the symbol are blocked for
 * WASH_SALE_BLOCK_DAYS. Returns true if the row was written.
 */
export async function addToWashSaleBlocklist(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from(table: string): any },
  userId: string,
  entry: BlocklistEntry
): Promise<boolean> {
  try {
    const harvestedAt = entry.harvestedAt ?? new Date().toISOString()
    const blockedUntil = new Date(
      new Date(harvestedAt).getTime() + WASH_SALE_BLOCK_DAYS * DAY_MS
    ).toISOString()

    const { error } = await supabase.from('wash_sale_blocklist').insert({
      user_id: userId,
      symbol: entry.symbol.toUpperCase(),
      asset_class: entry.assetClass,
      harvested_at: harvestedAt,
      blocked_until: blockedUntil,
      loss_amount_usd: entry.lossAmountUsd,
      status: 'active',
    })
    return !error
  } catch {
    return false
  }
}

// ─── Cost-basis adjustment ────────────────────────────────────────────────

export interface WashSaleAdjustmentInput {
  /** Shares sold at a loss */
  sharesSoldAtLoss: number
  /** Total realized loss on the sale, as a positive magnitude (USD) */
  totalLossUsd: number
  /** ISO date (YYYY-MM-DD) of the loss sale */
  saleDate: string
  /** Shares repurchased (the replacement lot) */
  replacementShares: number
  /** Per-share cost of the replacement lot (USD) */
  replacementCostPerShare: number
  /** ISO date (YYYY-MM-DD) the replacement lot was acquired */
  replacementAcquiredDate: string
}

export interface WashSaleAdjustmentResult {
  /** Whether the repurchase falls inside the ±30-day wash-sale window */
  isWashSale: boolean
  /** Shares of the loss sale matched to replacement shares */
  matchedShares: number
  /** Loss disallowed this year (USD, positive magnitude) */
  disallowedLossUsd: number
  /** Loss still claimable this year (USD, positive magnitude) */
  allowedLossUsd: number
  /** Replacement lot per-share basis after adding the disallowed loss */
  adjustedCostPerShare: number
  /** Total adjusted basis of the replacement lot */
  adjustedTotalBasisUsd: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Compute the wash-sale cost-basis adjustment for a repurchase.
 *
 * IRS rules (Pub. 550): when shares are repurchased within 30 days before
 * or after a loss sale, the loss on the *matched* shares is disallowed and
 * added to the basis of the replacement shares. If fewer shares are
 * repurchased than were sold, only a proportional part of the loss is
 * disallowed. The holding period of the sold shares also tacks onto the
 * replacement shares (callers should set `isLongTerm` accordingly when
 * recording the adjusted lot).
 */
export function computeWashSaleAdjustment(
  input: WashSaleAdjustmentInput
): WashSaleAdjustmentResult {
  const {
    sharesSoldAtLoss,
    totalLossUsd,
    saleDate,
    replacementShares,
    replacementCostPerShare,
    replacementAcquiredDate,
  } = input

  const baseBasis = round2(replacementShares * replacementCostPerShare)
  const noAdjustment: WashSaleAdjustmentResult = {
    isWashSale: false,
    matchedShares: 0,
    disallowedLossUsd: 0,
    allowedLossUsd: round2(Math.max(0, totalLossUsd)),
    adjustedCostPerShare: replacementCostPerShare,
    adjustedTotalBasisUsd: baseBasis,
  }

  if (sharesSoldAtLoss <= 0 || replacementShares <= 0 || totalLossUsd <= 0) {
    return noAdjustment
  }

  // Window check: replacement acquired within 30 days before or after sale.
  const saleMs = new Date(saleDate).getTime()
  const buyMs = new Date(replacementAcquiredDate).getTime()
  if (Math.abs(saleMs - buyMs) > WASH_SALE_WINDOW_DAYS * DAY_MS) {
    return noAdjustment
  }

  const matchedShares = Math.min(sharesSoldAtLoss, replacementShares)
  const disallowedLossUsd = round2((matchedShares / sharesSoldAtLoss) * totalLossUsd)
  const allowedLossUsd = round2(totalLossUsd - disallowedLossUsd)

  // Disallowed loss is added to the basis of the matched replacement shares.
  const adjustedTotalBasisUsd = round2(baseBasis + disallowedLossUsd)
  const adjustedCostPerShare = round2(adjustedTotalBasisUsd / replacementShares)

  return {
    isWashSale: true,
    matchedShares,
    disallowedLossUsd,
    allowedLossUsd,
    adjustedCostPerShare,
    adjustedTotalBasisUsd,
  }
}
