/**
 * Order Book Imbalance Confluence
 *
 * Fetches top-N-level order book depth from the appropriate venue and computes
 * bid/ask volume ratio. Used as a pre-entry confirmation filter:
 *   ratio > bullThreshold (default 1.8) --> bull signal (buyers loading)
 *   ratio < bearThreshold (default 0.55) --> bear signal (sellers loading)
 *   otherwise --> neutral
 *
 * Venue selection:
 *   crypto  : Binance REST (public, no key)
 *   stocks  : Polygon.io L2 (feature-flagged, paid) or IEX Deep (free fallback)
 *   forex   : always neutral (retail can't see real ECN depth)
 *   polymarket: always neutral (handled inside the strategy itself)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { FeatureFlagService } from '@/lib/feature-flags/FeatureFlagService'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImbalanceVenue = 'binance' | 'polygon_l2' | 'iex_deep' | 'neutral'

export interface ImbalanceConfig {
  levels: number         // default 10
  lookbackSeconds: number // staleness check (default 90s)
  bullThreshold: number  // default 1.8
  bearThreshold: number  // default 0.55
}

export interface ImbalanceVerdict {
  signal: 'bull' | 'bear' | 'neutral'
  ratio: number
  sampledAt: number
  venue: ImbalanceVenue
}

const DEFAULTS: ImbalanceConfig = {
  levels: 10,
  lookbackSeconds: 90,
  bullThreshold: 1.8,
  bearThreshold: 0.55,
}

// ─── Venue fetchers ───────────────────────────────────────────────────────────

const BINANCE_PAIRS: Record<string, string> = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT',
  XRP: 'XRPUSDT', DOGE: 'DOGEUSDT', BNB: 'BNBUSDT',
  ADA: 'ADAUSDT', AVAX: 'AVAXUSDT', MATIC: 'MATICUSDT',
}

async function fetchBinanceImbalance(symbol: string, levels: number): Promise<number | null> {
  const pair = BINANCE_PAIRS[symbol.toUpperCase()]
  if (!pair) return null
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/depth?symbol=${pair}&limit=${Math.min(levels, 20)}`,
      { signal: AbortSignal.timeout(4_000) }
    )
    if (!res.ok) return null
    const data = await res.json() as { bids: [string, string][]; asks: [string, string][] }
    const bidVol = data.bids.slice(0, levels).reduce((s, [, qty]) => s + parseFloat(qty), 0)
    const askVol = data.asks.slice(0, levels).reduce((s, [, qty]) => s + parseFloat(qty), 0)
    if (askVol === 0) return bidVol > 0 ? 99 : 1
    return bidVol / askVol
  } catch {
    return null
  }
}

async function fetchPolygonL2Imbalance(symbol: string): Promise<number | null> {
  const apiKey = process.env.POLYGON_API_KEY
  if (!apiKey) return null
  try {
    // Polygon snapshot: lastQuote has best bid/ask with sizes
    const res = await fetch(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(symbol)}?apiKey=${apiKey}`,
      { signal: AbortSignal.timeout(4_000) }
    )
    if (!res.ok) return null
    const data = await res.json() as {
      ticker?: { lastQuote?: { s?: number; S?: number } }
    }
    const bidSize = data.ticker?.lastQuote?.s ?? 0
    const askSize = data.ticker?.lastQuote?.S ?? 0
    if (askSize === 0) return bidSize > 0 ? 99 : 1
    return bidSize / askSize
  } catch {
    return null
  }
}

async function fetchIexDeepImbalance(symbol: string): Promise<number | null> {
  const apiKey = process.env.IEX_CLOUD_API_KEY
  if (!apiKey) return null
  try {
    const res = await fetch(
      `https://cloud.iexapis.com/stable/stock/${encodeURIComponent(symbol)}/book?token=${apiKey}`,
      { signal: AbortSignal.timeout(4_000) }
    )
    if (!res.ok) return null
    const data = await res.json() as {
      bids?: { price: number; size: number }[]
      asks?: { price: number; size: number }[]
    }
    const bidVol = (data.bids ?? []).reduce((s, b) => s + b.size, 0)
    const askVol = (data.asks ?? []).reduce((s, a) => s + a.size, 0)
    if (askVol === 0) return bidVol > 0 ? 99 : 1
    return bidVol / askVol
  } catch {
    return null
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch order book imbalance for `symbol` from `venue`.
 * Returns a neutral verdict whenever the venue is unreachable.
 */
export async function getOrderBookImbalance(
  symbol: string,
  venue: ImbalanceVenue,
  _side: 'long' | 'short',
  configOverrides?: Partial<ImbalanceConfig>
): Promise<ImbalanceVerdict> {
  const cfg = { ...DEFAULTS, ...configOverrides }
  const neutral: ImbalanceVerdict = { signal: 'neutral', ratio: 1.0, sampledAt: Date.now(), venue }

  if (venue === 'neutral') return neutral

  let ratio: number | null = null
  if (venue === 'binance') {
    ratio = await fetchBinanceImbalance(symbol, cfg.levels)
  } else if (venue === 'polygon_l2') {
    ratio = await fetchPolygonL2Imbalance(symbol)
  } else if (venue === 'iex_deep') {
    ratio = await fetchIexDeepImbalance(symbol)
  }

  if (ratio === null) return neutral

  // Staleness is inherent in snapshot; we mark sampledAt for callers to check
  const signal: ImbalanceVerdict['signal'] =
    ratio > cfg.bullThreshold ? 'bull'
    : ratio < cfg.bearThreshold ? 'bear'
    : 'neutral'

  return { signal, ratio, sampledAt: Date.now(), venue }
}

// ─── Strategy-level helper ─────────────────────────────────────────────────────

/**
 * Resolves the correct venue for an opportunity's asset class, respects the
 * polygon_l2 feature flag for stock strategies, and returns the imbalance verdict.
 *
 * Call from BasePipelineStrategy.runOrderBookImbalanceCheck().
 */
export async function resolveAndFetchImbalance(
  symbol: string,
  assetClass: 'stocks' | 'options' | 'crypto' | 'forex' | 'polymarket' | 'multi-asset',
  direction: 'long' | 'short',
  userId: string,
  supabase?: SupabaseClient,
  configOverrides?: Partial<ImbalanceConfig>
): Promise<ImbalanceVerdict | null> {
  if (assetClass === 'forex' || assetClass === 'polymarket') return null

  let venue: ImbalanceVenue

  if (assetClass === 'crypto') {
    venue = 'binance'
  } else if (assetClass === 'stocks' || assetClass === 'options' || assetClass === 'multi-asset') {
    if (supabase) {
      const svc = new FeatureFlagService(supabase)
      const gate = await svc.canSpend(userId, 'polygon_l2', 1)  // $0.01 per snapshot
      venue = gate.allowed ? 'polygon_l2' : 'iex_deep'
    } else {
      venue = 'iex_deep'
    }
  } else {
    return null
  }

  // Clean symbol: strip exchange prefix / perpetual suffix
  const cleanSymbol = symbol
    .replace(/^POLY:/, '')
    .replace(/-PERP$/, '')
    .split('-')[0]  // BTC-USD -> BTC, AAPL -> AAPL

  return getOrderBookImbalance(cleanSymbol, venue, direction, configOverrides)
}
