/**
 * Lido and LST (Liquid Staking Token) protocol data.
 * Prices from CoinGecko (public). Withdrawal queue from Lido API.
 */

export interface LstPoolPrice {
  lstSymbol: string        // 'stETH' | 'rETH' | 'cbETH'
  lstPriceUsd: number
  ethPriceUsd: number
  fairRatio: number        // expected LST/ETH ratio based on accumulated yield
  discountPct: number      // (fairRatio - actualRatio) / fairRatio
}

export interface WithdrawalQueue {
  avgDays: number          // estimated wait time in days
  queuedEth: number        // total ETH in queue
}

const CG_BASE = 'https://api.coingecko.com/api/v3'

const CG_IDS: Record<string, string> = {
  stETH: 'staked-ether',
  rETH:  'rocket-pool-eth',
  cbETH: 'coinbase-wrapped-staked-eth',
  ETH:   'ethereum',
}

async function getCgPrice(ids: string[]): Promise<Record<string, number>> {
  try {
    const joined = ids.join(',')
    const res = await fetch(
      `${CG_BASE}/simple/price?ids=${joined}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(5_000) }
    )
    if (!res.ok) return {}
    const data = await res.json() as Record<string, { usd?: number }>
    const result: Record<string, number> = {}
    for (const [id, val] of Object.entries(data)) {
      if (val.usd) result[id] = val.usd
    }
    return result
  } catch {
    return {}
  }
}

/**
 * Get LST pool price info for a given token (stETH, rETH, cbETH).
 * Returns null when price data is unavailable.
 */
export async function getLstPoolPrice(lstSymbol: string): Promise<LstPoolPrice | null> {
  const cgId = CG_IDS[lstSymbol]
  if (!cgId) return null

  const prices = await getCgPrice([cgId, CG_IDS.ETH])
  const lstPriceUsd = prices[cgId]
  const ethPriceUsd = prices[CG_IDS.ETH]
  if (!lstPriceUsd || !ethPriceUsd) return null

  // Fair ratio: LST/ETH price should equal the accumulated yield ratio
  // Simplified: for stETH fair ratio ≈ 1.0 (tracks ETH + staking yield)
  // A small discount indicates a buying opportunity (withdrawal queue risk)
  const actualRatio = lstPriceUsd / ethPriceUsd
  const fairRatio = 1.0   // simplified; real impl reads Lido's accumulatedYieldRatio
  const discountPct = Math.max(0, (fairRatio - actualRatio) / fairRatio)

  return { lstSymbol, lstPriceUsd, ethPriceUsd, fairRatio, discountPct }
}

/**
 * Estimate Lido withdrawal queue wait time.
 * Uses Lido's public request-time API.
 */
export async function getWithdrawalQueueDays(): Promise<number> {
  try {
    const res = await fetch(
      'https://stake.lido.fi/api/request-time',
      { signal: AbortSignal.timeout(4_000) }
    )
    if (!res.ok) return 7   // default conservative estimate
    const data = await res.json() as { requestTime?: number }
    // requestTime is in seconds
    return (data.requestTime ?? 7 * 86_400) / 86_400
  } catch {
    return 7
  }
}

/**
 * Get accumulated yield ratio for an LST token (approx fair value vs ETH).
 * Simplified implementation: returns 1.0 + annualised_staking_yield / 365_per_day.
 */
export async function getAccumulatedYieldRatio(_lstSymbol: string): Promise<number> {
  // Real implementation would query Lido contract exchange rate.
  // 3.5% APY / 365 per day, compounded — simplify to 1.0 for now.
  return 1.0
}
