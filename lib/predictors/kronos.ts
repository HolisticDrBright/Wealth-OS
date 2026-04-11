/**
 * Kronos financial time-series forecasting adapter.
 * Repo: https://github.com/shiyu-coder/Kronos
 * Architecture: two-stage — OHLCV tokenizer + autoregressive Transformer.
 * Models on Hugging Face: Kronos-mini (4.1M), -small (24.7M), -base (102.3M), -large (499.2M)
 *
 * Runtime modes:
 *   1. Self-hosted:  set KRONOS_API_URL=http://localhost:8787  (FastAPI wrapper)
 *   2. HF Inference: set KRONOS_HF_MODEL=shiyu-coder/Kronos-base
 *                        HF_API_TOKEN=hf_...
 *   3. Offline:      falls back to momentum score (returns null)
 */

import type { PriceBar } from '@/lib/backtester'

export interface KronosPrediction {
  symbol: string
  /** Forecast horizon in bars (default = 5 trading days) */
  horizon: number
  /** Predicted close prices for each horizon bar */
  predicted_closes: number[]
  /** Expected return over horizon (fraction, e.g. 0.023 = +2.3%) */
  expected_return: number
  /** Direction: 1 = up, -1 = down, 0 = neutral */
  direction: 1 | -1 | 0
  /** Confidence [0,1] derived from token probability mass */
  confidence: number
  /** Which backend produced this result */
  source: 'kronos-api' | 'kronos-hf' | 'momentum-fallback'
}

/** OHLCV row sent to the Kronos inference service */
interface OHLCVRow {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** Shape expected back from a self-hosted Kronos FastAPI server */
interface KronosApiResponse {
  symbol: string
  horizon: number
  predicted_closes: number[]
  confidence: number
}

// ─── HTTP helpers ─────────────────────────────────────────

async function callKronosApi(
  symbol: string,
  rows: OHLCVRow[],
  horizon: number
): Promise<KronosPrediction | null> {
  const baseUrl = process.env.KRONOS_API_URL
  if (!baseUrl) return null

  try {
    const res = await fetch(`${baseUrl}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, ohlcv: rows, horizon }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const data: KronosApiResponse = await res.json()
    const last = rows[rows.length - 1].close
    const predicted_last = data.predicted_closes[data.predicted_closes.length - 1]
    const expected_return = (predicted_last - last) / last
    return {
      symbol,
      horizon: data.horizon,
      predicted_closes: data.predicted_closes,
      expected_return,
      direction: expected_return > 0.002 ? 1 : expected_return < -0.002 ? -1 : 0,
      confidence: data.confidence,
      source: 'kronos-api',
    }
  } catch {
    return null
  }
}

async function callKronosHF(
  symbol: string,
  rows: OHLCVRow[],
  horizon: number
): Promise<KronosPrediction | null> {
  const model = process.env.KRONOS_HF_MODEL
  const token = process.env.HF_API_TOKEN
  if (!model || !token) return null

  try {
    const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: { symbol, ohlcv: rows, horizon } }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return null
    const data = await res.json()
    // HF inference API wraps the model output; shape may vary — extract best-effort
    const predicted_closes: number[] = data.predicted_closes ?? data[0]?.predicted_closes ?? []
    if (!predicted_closes.length) return null
    const last = rows[rows.length - 1].close
    const predicted_last = predicted_closes[predicted_closes.length - 1]
    const expected_return = (predicted_last - last) / last
    return {
      symbol,
      horizon,
      predicted_closes,
      expected_return,
      direction: expected_return > 0.002 ? 1 : expected_return < -0.002 ? -1 : 0,
      confidence: data.confidence ?? 0.5,
      source: 'kronos-hf',
    }
  } catch {
    return null
  }
}

/** Momentum fallback when Kronos is unavailable */
function momentumFallback(symbol: string, bars: PriceBar[], horizon: number): KronosPrediction {
  const recent = bars[bars.length - 1].close
  const lookback = bars.length >= 20 ? bars[bars.length - 20].close : bars[0].close
  const momentum = (recent - lookback) / lookback
  // Project linearly — crude but consistent with existing backtester signal
  const dailyRate = momentum / 20
  const predicted_closes = Array.from({ length: horizon }, (_, i) =>
    Math.round(recent * (1 + dailyRate * (i + 1)) * 100) / 100
  )
  const expected_return = dailyRate * horizon
  return {
    symbol,
    horizon,
    predicted_closes,
    expected_return,
    direction: expected_return > 0.002 ? 1 : expected_return < -0.002 ? -1 : 0,
    confidence: Math.min(0.4, Math.abs(momentum)),
    source: 'momentum-fallback',
  }
}

// ─── Public API ───────────────────────────────────────────

/**
 * Get a price forecast for a single symbol.
 * Tries: self-hosted API → HF Inference → momentum fallback.
 *
 * @param symbol  Ticker, e.g. "AAPL"
 * @param bars    Historical OHLCV bars (caller supplies, sorted ascending)
 * @param horizon Bars to forecast ahead (default 5 = 1 trading week)
 */
export async function kronosPredict(
  symbol: string,
  bars: PriceBar[],
  horizon = 5
): Promise<KronosPrediction> {
  if (bars.length < 20) return momentumFallback(symbol, bars, horizon)

  const rows: OHLCVRow[] = bars.slice(-120).map(b => ({
    date: b.date,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume ?? 0,
  }))

  const result =
    (await callKronosApi(symbol, rows, horizon)) ??
    (await callKronosHF(symbol, rows, horizon)) ??
    momentumFallback(symbol, bars, horizon)

  return result
}

/**
 * Batch forecast for multiple symbols.
 * Returns a map of symbol → prediction.
 */
export async function kronosPredictBatch(
  symbolBars: Map<string, PriceBar[]>,
  horizon = 5
): Promise<Map<string, KronosPrediction>> {
  const results = await Promise.all(
    Array.from(symbolBars.entries()).map(([sym, bars]) => kronosPredict(sym, bars, horizon))
  )
  return new Map(results.map(r => [r.symbol, r]))
}
