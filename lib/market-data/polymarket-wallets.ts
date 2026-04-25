/**
 * Polymarket wallet tracker.
 *
 * Reads open positions for a set of tracked wallet addresses via the
 * Polymarket CLOB REST API (public, no auth required).
 *
 * Tracked wallets are configured via POLYMARKET_TRACKED_WALLETS env var
 * as a comma-separated list of EVM addresses.
 */

export interface WalletPosition {
  /** EVM address of the tracked wallet */
  wallet: string
  conditionId: string
  market_slug?: string
  question?: string
  side: 'YES' | 'NO'
  /** Current holding size in shares */
  size: number
  /** Average entry price */
  avg_price: number
  /** Current market price */
  current_price: number
  /** Unrealised PnL */
  unrealised_pnl: number
  last_updated: string
}

export interface WalletTrade {
  wallet: string
  conditionId: string
  side: 'YES' | 'NO'
  size: number
  price: number
  timestamp: string
  transaction_hash: string
}

const CLOB_BASE = 'https://clob.polymarket.com'
const GAMMA_BASE = 'https://gamma-api.polymarket.com'

/** Get tracked wallet addresses from env var */
export function getTrackedWallets(): string[] {
  const raw = process.env.POLYMARKET_TRACKED_WALLETS ?? ''
  return raw
    .split(',')
    .map(w => w.trim().toLowerCase())
    .filter(w => w.startsWith('0x') && w.length === 42)
}

/**
 * Fetch recent trades for a wallet address from the Polymarket data API.
 * Returns the most recent N trades sorted descending by timestamp.
 */
export async function getWalletTrades(
  wallet: string,
  limit = 20
): Promise<WalletTrade[]> {
  try {
    const res = await fetch(
      `${CLOB_BASE}/trades?maker_address=${wallet}&limit=${limit}&status=MATCHED`,
      { signal: AbortSignal.timeout(8_000) }
    )
    if (!res.ok) return []
    const data = await res.json()
    const trades = data.data ?? data ?? []

    return trades.map((t: Record<string, unknown>) => ({
      wallet,
      conditionId: String(t.market ?? t.condition_id ?? ''),
      side: String(t.side ?? 'YES').toUpperCase() as 'YES' | 'NO',
      size: Number(t.size ?? 0),
      price: Number(t.price ?? 0),
      timestamp: String(t.matched_time ?? t.timestamp ?? new Date().toISOString()),
      transaction_hash: String(t.transaction_hash ?? ''),
    }))
  } catch {
    return []
  }
}

/**
 * Fetch open positions for a wallet address.
 */
export async function getWalletPositions(wallet: string): Promise<WalletPosition[]> {
  try {
    const res = await fetch(
      `${GAMMA_BASE}/positions?user=${wallet}&limit=50&sortBy=CURRENT_VALUE&sortDirection=DESC`,
      { signal: AbortSignal.timeout(8_000) }
    )
    if (!res.ok) return []
    const data = await res.json()
    const positions = data.positions ?? data ?? []

    return positions.map((p: Record<string, unknown>) => ({
      wallet,
      conditionId: String(p.conditionId ?? p.market ?? ''),
      market_slug: String(p.market_slug ?? ''),
      question: String(p.question ?? ''),
      side: String(p.outcome ?? 'YES').toUpperCase() as 'YES' | 'NO',
      size: Number(p.size ?? 0),
      avg_price: Number(p.avg_price ?? p.price ?? 0),
      current_price: Number(p.cur_price ?? p.current_price ?? 0),
      unrealised_pnl: Number(p.unrealised_pnl ?? 0),
      last_updated: String(p.last_updated ?? new Date().toISOString()),
    }))
  } catch {
    return []
  }
}

/**
 * Scan all tracked wallets for recent trades in the last N seconds.
 * Used to detect when a tracked wallet opens a new position to copy.
 */
export async function scanTrackedWalletTrades(
  sinceSeconds = 300
): Promise<WalletTrade[]> {
  const wallets = getTrackedWallets()
  if (wallets.length === 0) return []

  const cutoff = new Date(Date.now() - sinceSeconds * 1000)
  const allTrades = await Promise.all(wallets.map(w => getWalletTrades(w, 50)))

  return allTrades
    .flat()
    .filter(t => new Date(t.timestamp) >= cutoff)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

/**
 * Get market details for a condition ID (question text, current prices, liquidity).
 */
export async function getMarketDetails(conditionId: string): Promise<{
  question: string
  yes_price: number
  no_price: number
  liquidity: number
  end_date_iso: string
} | null> {
  try {
    const res = await fetch(
      `${GAMMA_BASE}/markets?condition_id=${conditionId}`,
      { signal: AbortSignal.timeout(6_000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    const m = Array.isArray(data) ? data[0] : data
    if (!m) return null
    return {
      question: String(m.question ?? ''),
      yes_price: Number(m.outcomePrices?.[0] ?? m.yes_price ?? 0.5),
      no_price: Number(m.outcomePrices?.[1] ?? m.no_price ?? 0.5),
      liquidity: Number(m.liquidity ?? 0),
      end_date_iso: String(m.end_date_iso ?? m.endDate ?? ''),
    }
  } catch {
    return null
  }
}
