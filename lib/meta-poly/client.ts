import 'server-only'

import type {
  HealthResponse,
  Market,
  SignalsResponse,
  PortfolioStats,
  PositionsResponse,
  TradeStats,
  TradeLogResponse,
  LeaderboardEntry,
  WhaleEvent,
  SmartMoneyIndexResponse,
  EntropyMarket,
  SettingsResponse,
  SignalStrategy,
} from './types'

// ─── Result type ──────────────────────────────────────────────────────────────

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }

function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

function err<T>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message } }
}

// ─── Circuit breaker ──────────────────────────────────────────────────────────

const FAILURE_THRESHOLD = 3
const OPEN_DURATION_MS = 60_000

let _failures = 0
let _openedAt: number | null = null

function circuitOpen(): boolean {
  if (_failures < FAILURE_THRESHOLD) return false
  if (_openedAt === null) return false
  return Date.now() - _openedAt < OPEN_DURATION_MS
}

function recordSuccess(): void {
  _failures = 0
  _openedAt = null
}

function recordFailure(): void {
  _failures++
  if (_failures >= FAILURE_THRESHOLD && _openedAt === null) {
    _openedAt = Date.now()
  }
}

// ─── Core fetcher ─────────────────────────────────────────────────────────────

const TIMEOUT_MS = 3_000

function baseUrl(): string {
  return (process.env.META_POLY_URL ?? 'http://localhost:8000').replace(/\/$/, '')
}

async function fetcher<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  if (circuitOpen()) {
    const remaining = Math.ceil((OPEN_DURATION_MS - (Date.now() - _openedAt!)) / 1000)
    return err('CIRCUIT_OPEN', `Meta_Poly_tarder offline — retrying in ${remaining}s`)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
    })

    if (!res.ok) {
      recordFailure()
      let message = `HTTP ${res.status}`
      try { const d = await res.json(); message = d.detail ?? d.error ?? message } catch {}
      return err(`HTTP_${res.status}`, message)
    }

    const data = await res.json() as T
    recordSuccess()
    return ok(data)
  } catch (e) {
    recordFailure()
    if (e instanceof Error && e.name === 'AbortError') {
      return err('TIMEOUT', 'Request timed out after 3s')
    }
    const msg = e instanceof Error ? e.message : 'Unknown error'
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      return err('UNREACHABLE', 'Meta_Poly_tarder is not reachable — is it running?')
    }
    return err('FETCH_ERROR', msg)
  } finally {
    clearTimeout(timer)
  }
}

function post<T>(path: string, body: unknown): Promise<Result<T>> {
  return fetcher<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getHealth(): Promise<Result<HealthResponse>> {
  return fetcher<HealthResponse>('/health')
}

export async function getActiveMarkets(opts?: {
  limit?: number
  minLiquidity?: number
}): Promise<Result<Market[]>> {
  const params = new URLSearchParams()
  if (opts?.limit) params.set('limit', String(opts.limit))
  if (opts?.minLiquidity) params.set('min_liquidity', String(opts.minLiquidity))
  const qs = params.size ? `?${params}` : ''
  return fetcher<Market[]>(`/api/markets${qs}`)
}

export async function getMarket(conditionId: string): Promise<Result<Market>> {
  return fetcher<Market>(`/api/markets/${encodeURIComponent(conditionId)}`)
}

export async function getSignals(opts?: {
  limit?: number
  strategy?: SignalStrategy
}): Promise<Result<SignalsResponse>> {
  const params = new URLSearchParams()
  if (opts?.limit) params.set('limit', String(opts.limit))
  const qs = params.size ? `?${params}` : ''

  const result = await fetcher<SignalsResponse>(`/api/signals${qs}`)
  if (!result.ok || !opts?.strategy) return result

  return ok({
    signals: result.value.signals.filter(s => s.strategy === opts.strategy),
    count: result.value.signals.filter(s => s.strategy === opts.strategy).length,
  })
}

export interface PortfolioState {
  stats: PortfolioStats
  positions: PositionsResponse
}

export async function getPortfolio(): Promise<Result<PortfolioState>> {
  const [statsRes, posRes] = await Promise.all([
    fetcher<PortfolioStats>('/api/portfolio/stats'),
    fetcher<PositionsResponse>('/api/portfolio/positions'),
  ])
  if (!statsRes.ok) return statsRes
  if (!posRes.ok) return posRes
  return ok({ stats: statsRes.value, positions: posRes.value })
}

export async function getPortfolioStats(): Promise<Result<PortfolioStats>> {
  return fetcher<PortfolioStats>('/api/portfolio/stats')
}

export async function getPositions(): Promise<Result<PositionsResponse>> {
  return fetcher<PositionsResponse>('/api/portfolio/positions')
}

export async function getTradeStats(): Promise<Result<TradeStats>> {
  return fetcher<TradeStats>('/api/portfolio/trade-stats')
}

export async function getTradeLog(opts?: {
  limit?: number
  filter?: 'all' | 'wins' | 'losses'
}): Promise<Result<TradeLogResponse>> {
  const params = new URLSearchParams()
  if (opts?.limit) params.set('limit', String(opts.limit))
  if (opts?.filter) params.set('filter', opts.filter)
  const qs = params.size ? `?${params}` : ''
  return fetcher<TradeLogResponse>(`/api/portfolio/trade-log${qs}`)
}

export interface WhaleActivity {
  trades: WhaleEvent[]
  leaderboard: LeaderboardEntry[]
  smartMoneyIndex: SmartMoneyIndexResponse
}

export async function getWhaleActivity(): Promise<Result<WhaleActivity>> {
  const [tradesRes, lbRes, smiRes] = await Promise.all([
    fetcher<{ trades: WhaleEvent[] }>('/api/whale/trades'),
    fetcher<{ entries: LeaderboardEntry[] }>('/api/whale/leaderboard'),
    fetcher<SmartMoneyIndexResponse>('/api/whale/smart-money-index'),
  ])
  if (!tradesRes.ok) return tradesRes
  if (!lbRes.ok) return lbRes
  if (!smiRes.ok) return smiRes
  return ok({
    trades: tradesRes.value.trades,
    leaderboard: lbRes.value.entries,
    smartMoneyIndex: smiRes.value,
  })
}

export async function getSettings(): Promise<Result<SettingsResponse>> {
  return fetcher<SettingsResponse>('/api/settings')
}

export async function getEntropyMetrics(limit = 20): Promise<Result<EntropyMarket[]>> {
  const res = await fetcher<{ markets: EntropyMarket[]; count: number }>(
    `/api/entropy/top?limit=${limit}`
  )
  if (!res.ok) return res
  return ok(res.value.markets)
}

// Strategy flag name → settings API field name
const STRATEGY_FLAG_MAP: Record<string, string> = {
  entropy: 'entropy_enabled',
  avellaneda: 'avellaneda_enabled',
  theta: 'theta_enabled',
  ensemble: 'ensemble_enabled',
  ensemble_ai: 'ensemble_enabled',
  binance_arb: 'binance_arb_enabled',
}

export async function setStrategyFlag(
  name: SignalStrategy,
  enabled: boolean,
): Promise<Result<{ updated: string[]; message: string }>> {
  const field = STRATEGY_FLAG_MAP[name]
  if (!field) {
    return err('UNKNOWN_STRATEGY', `Strategy "${name}" does not have a live toggle`)
  }
  return post('/api/settings/update', { [field]: enabled })
}

export async function openPaperPosition(
  marketId: string,
  side: 'YES' | 'NO',
  sizeUsdc: number,
  price: number,
): Promise<Result<{ status: string; mode: string; market_id: string }>> {
  return post('/api/portfolio/order', {
    market_id: marketId,
    side,
    price,
    size_usdc: sizeUsdc,
    reason: 'manual via Wealth OS',
  })
}

export async function closePaperPosition(
  marketId: string,
): Promise<Result<{ status: string; market_id: string; pnl: number }>> {
  return post('/api/portfolio/close', { market_id: marketId })
}

/** Expose circuit breaker state for the service-status banner. */
export function getCircuitState(): {
  failures: number
  open: boolean
  retriesInMs: number
} {
  const open = circuitOpen()
  return {
    failures: _failures,
    open,
    retriesInMs: open ? OPEN_DURATION_MS - (Date.now() - _openedAt!) : 0,
  }
}
