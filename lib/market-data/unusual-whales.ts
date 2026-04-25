/**
 * Unusual Whales API client.
 * Docs: https://unusualwhales.com/api
 *
 * Endpoints used:
 *   GET /api/congress/recent
 *   GET /api/option-trades/flow-alerts
 *   GET /api/darkpool/recent
 */

export interface UWCongressTrade {
  politician: string
  ticker: string
  asset_description: string
  transaction_date: string
  disclosure_date: string
  trade_size_range: string
  transaction_type: 'buy' | 'sell' | 'exchange'
  chamber: 'senate' | 'house'
  party: 'republican' | 'democrat' | 'independent'
  amount_usd?: number
}

export interface OptionsFlowAlert {
  ticker: string
  strike: number
  expiry: string
  option_type: 'call' | 'put'
  premium: number       // total premium in USD
  volume: number
  open_interest: number
  sentiment: 'bullish' | 'bearish' | 'neutral'
  unusual_score: number // 0-100
  trade_time: string
}

export interface DarkPoolTrade {
  ticker: string
  size: number          // shares
  price: number
  premium: number       // notional USD
  dark_pool_position: 'above_ask' | 'below_bid' | 'at_mid'
  trade_date: string
}

const BASE = 'https://api.unusualwhales.com'

function headers() {
  const key = process.env.UNUSUAL_WHALES_API_KEY
  if (!key) throw new Error('UNUSUAL_WHALES_API_KEY not set')
  return { Authorization: `Bearer ${key}` }
}

function parseAmount(range: string): number {
  const nums = range.replace(/[$,KMB]/gi, s => {
    if (s === 'K') return '000'
    if (s === 'M') return '000000'
    if (s === 'B') return '000000000'
    return ''
  }).match(/\d+/g)?.map(Number) ?? []
  if (nums.length === 0) return 0
  return nums.length === 1 ? nums[0] : (nums[0] + nums[1]) / 2
}

/** Recent congressional trades from Unusual Whales. */
export async function getUWCongressTrades(limit = 50): Promise<UWCongressTrade[]> {
  const key = process.env.UNUSUAL_WHALES_API_KEY
  if (!key) return []

  try {
    const res = await fetch(`${BASE}/api/congress/recent?limit=${limit}`, {
      headers: headers(),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    const data = await res.json()
    const trades: UWCongressTrade[] = data.data ?? data ?? []
    return trades.map(t => ({ ...t, amount_usd: parseAmount(t.trade_size_range ?? '') }))
  } catch {
    return []
  }
}

/** Options flow alerts with unusual activity score. */
export async function getOptionsFlowAlerts(opts?: {
  minScore?: number
  minPremium?: number
  sentiment?: 'bullish' | 'bearish'
}): Promise<OptionsFlowAlert[]> {
  const key = process.env.UNUSUAL_WHALES_API_KEY
  if (!key) return []

  try {
    const params = new URLSearchParams({ limit: '100' })
    const res = await fetch(`${BASE}/api/option-trades/flow-alerts?${params}`, {
      headers: headers(),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    const data = await res.json()
    let alerts: OptionsFlowAlert[] = data.data ?? data ?? []

    if (opts?.minScore) alerts = alerts.filter(a => a.unusual_score >= opts.minScore!)
    if (opts?.minPremium) alerts = alerts.filter(a => a.premium >= opts.minPremium!)
    if (opts?.sentiment) alerts = alerts.filter(a => a.sentiment === opts.sentiment)

    return alerts.sort((a, b) => b.unusual_score - a.unusual_score)
  } catch {
    return []
  }
}

/** Dark pool prints above $1M — institutional positioning signal. */
export async function getDarkPoolTrades(minPremium = 1_000_000): Promise<DarkPoolTrade[]> {
  const key = process.env.UNUSUAL_WHALES_API_KEY
  if (!key) return []

  try {
    const res = await fetch(`${BASE}/api/darkpool/recent?limit=200`, {
      headers: headers(),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    const data = await res.json()
    const trades: DarkPoolTrade[] = data.data ?? data ?? []
    return trades
      .filter(t => t.premium >= minPremium)
      .sort((a, b) => b.premium - a.premium)
  } catch {
    return []
  }
}
