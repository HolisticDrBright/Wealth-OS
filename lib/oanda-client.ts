const isPractice = process.env.OANDA_PRACTICE !== 'false'
const OANDA_BASE = isPractice
  ? 'https://api-fxpractice.oanda.com'
  : 'https://api-fxtrade.oanda.com'

async function oandaFetch(path: string, init?: RequestInit): Promise<unknown> {
  const key = process.env.OANDA_API_KEY
  if (!key) throw new Error('OANDA_API_KEY not configured')

  const res = await fetch(`${OANDA_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const data = await res.json() as Record<string, unknown>
  if (!res.ok) throw new Error(JSON.stringify(data))
  return data
}

export interface OandaPrice {
  instrument: string
  bid: number
  ask: number
  spread_pips: number
}

export async function getPricing(instruments: string[]): Promise<OandaPrice[]> {
  const accountId = process.env.OANDA_ACCOUNT_ID
  if (!accountId) throw new Error('OANDA_ACCOUNT_ID not configured')

  const data = await oandaFetch(
    `/v3/accounts/${accountId}/pricing?instruments=${instruments.join('%2C')}`
  ) as { prices: Array<{ instrument: string; bids: Array<{ price: string }>; asks: Array<{ price: string }> }> }

  return (data.prices ?? []).map(p => {
    const bid = parseFloat(p.bids?.[0]?.price ?? '0')
    const ask = parseFloat(p.asks?.[0]?.price ?? '0')
    const pipSize = p.instrument.includes('JPY') ? 0.01 : 0.0001
    return { instrument: p.instrument, bid, ask, spread_pips: (ask - bid) / pipSize }
  })
}

export interface OandaAccount {
  id: string
  currency: string
  balance: number
  nav: number
  unrealized_pl: number
  open_trade_count: number
}

export async function getAccount(): Promise<OandaAccount> {
  const accountId = process.env.OANDA_ACCOUNT_ID
  if (!accountId) throw new Error('OANDA_ACCOUNT_ID not configured')

  const data = await oandaFetch(`/v3/accounts/${accountId}/summary`) as {
    account: { id: string; currency: string; balance: string; NAV: string; unrealizedPL: string; openTradeCount: number }
  }
  const a = data.account
  return {
    id: a.id,
    currency: a.currency,
    balance: parseFloat(a.balance),
    nav: parseFloat(a.NAV),
    unrealized_pl: parseFloat(a.unrealizedPL),
    open_trade_count: a.openTradeCount,
  }
}

export interface OandaTrade {
  id: string
  instrument: string
  price: number
  current_units: number
  unrealized_pl: number
}

export async function getOpenTrades(): Promise<OandaTrade[]> {
  const accountId = process.env.OANDA_ACCOUNT_ID
  if (!accountId) throw new Error('OANDA_ACCOUNT_ID not configured')

  const data = await oandaFetch(`/v3/accounts/${accountId}/openTrades`) as {
    trades: Array<{ id: string; instrument: string; price: string; currentUnits: string; unrealizedPL: string }>
  }
  return (data.trades ?? []).map(t => ({
    id: t.id,
    instrument: t.instrument,
    price: parseFloat(t.price),
    current_units: parseFloat(t.currentUnits),
    unrealized_pl: parseFloat(t.unrealizedPL),
  }))
}

// ─── Candles ──────────────────────────────────────────────────────────────────

export interface OandaCandle {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  complete: boolean
}

// ─── Yahoo Finance forex fallback ─────────────────────────────────────────────

/** Convert OANDA instrument (EUR_USD) to Yahoo Finance ticker (EURUSD=X). */
function toYahooFxTicker(instrument: string): string {
  return instrument.replace('_', '') + '=X'
}

const YF_INTERVAL: Record<string, string> = {
  M1: '1m', M5: '5m', M15: '15m', H1: '1h', H4: '1h', D: '1d',
}
// Yahoo Finance range that gives enough bars for each granularity
const YF_RANGE: Record<string, string> = {
  M1: '1d', M5: '5d', M15: '5d', H1: '60d', H4: '60d', D: '2y',
}

async function getYahooForexCandles(
  instrument: string,
  granularity: 'M1' | 'M5' | 'M15' | 'H1' | 'H4' | 'D',
  count: number
): Promise<OandaCandle[]> {
  try {
    const ticker   = toYahooFxTicker(instrument)
    const interval = YF_INTERVAL[granularity] ?? '1d'
    const range    = YF_RANGE[granularity]    ?? '2y'

    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}`,
      { signal: AbortSignal.timeout(6_000) }
    )
    if (!res.ok) return []

    const data = await res.json() as {
      chart?: { result?: Array<{
        timestamp: number[]
        indicators: { quote: Array<{ open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }> }
      }> }
    }

    const result = data.chart?.result?.[0]
    if (!result) return []

    const { timestamp, indicators } = result
    const q = indicators.quote[0]
    const candles: OandaCandle[] = []

    for (let i = 0; i < timestamp.length; i++) {
      if (q.open[i] == null || q.close[i] == null) continue
      candles.push({
        time:     new Date(timestamp[i] * 1000).toISOString(),
        open:     q.open[i],
        high:     q.high[i] ?? q.close[i],
        low:      q.low[i]  ?? q.close[i],
        close:    q.close[i],
        volume:   q.volume[i] ?? 0,
        complete: true,
      })
    }

    // H4: aggregate 1h candles into 4-hour blocks
    if (granularity === 'H4') {
      const h4: OandaCandle[] = []
      for (let i = 0; i < candles.length; i += 4) {
        const block = candles.slice(i, i + 4)
        if (block.length === 0) continue
        h4.push({
          time:     block[0].time,
          open:     block[0].open,
          high:     Math.max(...block.map(c => c.high)),
          low:      Math.min(...block.map(c => c.low)),
          close:    block[block.length - 1].close,
          volume:   block.reduce((s, c) => s + c.volume, 0),
          complete: true,
        })
      }
      return h4.slice(-count)
    }

    return candles.slice(-count)
  } catch {
    return []
  }
}

async function getYahooBidAsk(
  instrument: string
): Promise<{ bid: number; ask: number } | null> {
  try {
    const ticker = toYahooFxTicker(instrument)
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`,
      { signal: AbortSignal.timeout(5_000) }
    )
    if (!res.ok) return null

    const data = await res.json() as {
      chart?: { result?: Array<{ meta: { regularMarketPrice: number } }> }
    }
    const mid = data.chart?.result?.[0]?.meta?.regularMarketPrice
    if (!mid) return null

    // Estimate a typical interbank spread (1.5 pips for majors, 3 pips for JPY)
    const pipSize = instrument.includes('JPY') ? 0.01 : 0.0001
    const halfSpread = 1.5 * pipSize / 2
    return { bid: mid - halfSpread, ask: mid + halfSpread }
  } catch {
    return null
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** True if OANDA is configured (real trading-quality data). */
export function oandaEnabled(): boolean {
  return !!(process.env.OANDA_API_KEY && process.env.OANDA_ACCOUNT_ID)
}

/**
 * Fetch candlestick data.
 * Uses OANDA when configured, falls back to Yahoo Finance (free) otherwise.
 */
export async function getCandles(
  instrument: string,
  granularity: 'M1' | 'M5' | 'M15' | 'H1' | 'H4' | 'D',
  count: number
): Promise<OandaCandle[]> {
  if (!oandaEnabled()) {
    return getYahooForexCandles(instrument, granularity, count)
  }
  try {
    const data = await oandaFetch(
      `/v3/instruments/${instrument}/candles?granularity=${granularity}&count=${count}&price=M`
    ) as { candles: Array<{ time: string; mid: { o: string; h: string; l: string; c: string }; volume: number; complete: boolean }> }
    return (data.candles ?? []).map(c => ({
      time: c.time,
      open:  parseFloat(c.mid.o),
      high:  parseFloat(c.mid.h),
      low:   parseFloat(c.mid.l),
      close: parseFloat(c.mid.c),
      volume: c.volume,
      complete: c.complete,
    }))
  } catch {
    return []
  }
}

/** Fetch current bid/ask. Uses OANDA when configured, Yahoo Finance otherwise. */
export async function getBidAsk(
  instrument: string
): Promise<{ bid: number; ask: number } | null> {
  if (!oandaEnabled()) {
    return getYahooBidAsk(instrument)
  }
  try {
    const prices = await getPricing([instrument])
    const p = prices[0]
    if (!p) return null
    return { bid: p.bid, ask: p.ask }
  } catch {
    return null
  }
}
