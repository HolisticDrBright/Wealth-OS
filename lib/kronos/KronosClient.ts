/**
 * KronosClient — high-level interface to the self-hosted Kronos forecasting
 * service (deployed on Hetzner).
 *
 * Unlike lib/predictors/kronos.ts (which accepts raw PriceBar arrays), this
 * client takes human-readable parameters (symbol, interval, horizonHours) and
 * returns a distribution-based forecast. The server-side Kronos service handles
 * data retrieval internally.
 *
 * Self-hosted endpoint: KRONOS_BASE_URL env var (e.g. http://kronos.internal:8787)
 * Falls back to a Claude-generated synthetic distribution when KRONOS_BASE_URL
 * is not configured.
 */

import Anthropic from '@anthropic-ai/sdk'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KronosDistributionPoint {
  price: number
  probability: number
}

export interface KronosForecast {
  distribution: KronosDistributionPoint[]
  skew: 'bullish' | 'neutral' | 'bearish'
  skewStrength: number       // -1 (strongly bearish) to +1 (strongly bullish)
  impliedMove: { p10: number; p50: number; p90: number }
  confidenceScore: number    // 0-100
  generatedAt: string        // ISO-8601
}

export interface KronosSyntheticKline {
  open: number
  high: number
  low: number
  close: number
  volume: number
  timestamp: string          // ISO-8601
}

export interface ForecastParams {
  symbol: string
  interval: '1h' | '4h' | '1d'
  horizonHours: 24 | 48 | 72
  contextHours?: number      // default 360 per Kronos paper
}

export interface SyntheticKlineParams {
  symbol: string
  startConditions: {
    volatility: number       // annualized, e.g. 0.25 for 25%
    regime: 'normal' | 'stress' | 'crisis'
  }
  lengthHours: number
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class KronosClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * Fetch a distributional price forecast from the self-hosted Kronos service.
   * Falls back to Claude synthesis when the service is unreachable.
   */
  async forecast(params: ForecastParams): Promise<KronosForecast> {
    const result = await this._callApi(params)
    if (result) return result
    return this._claudeFallback(params)
  }

  /**
   * Generate synthetic OHLCV K-lines for stress testing (used by Tail Risk Hedging).
   */
  async generateSyntheticKlines(params: SyntheticKlineParams): Promise<KronosSyntheticKline[]> {
    try {
      const res = await fetch(`${this.baseUrl}/synthetic-klines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    } catch {
      return this._syntheticKlinesFallback(params)
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _callApi(params: ForecastParams): Promise<KronosForecast | null> {
    if (!this.baseUrl) return null
    try {
      const res = await fetch(`${this.baseUrl}/forecast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: params.symbol,
          interval: params.interval,
          horizon_hours: params.horizonHours,
          context_hours: params.contextHours ?? 360,
        }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return null
      const raw = await res.json()
      return this._normaliseResponse(raw)
    } catch {
      return null
    }
  }

  private _normaliseResponse(raw: Record<string, unknown>): KronosForecast {
    const dist = (raw.distribution as KronosDistributionPoint[] | undefined) ?? []
    const sortedPrices = dist
      .sort((a, b) => a.probability - b.probability)
      .map(d => d.price)
    const len = sortedPrices.length

    const p10 = sortedPrices[Math.floor(len * 0.10)] ?? 0
    const p50 = sortedPrices[Math.floor(len * 0.50)] ?? 0
    const p90 = sortedPrices[Math.floor(len * 0.90)] ?? 0

    const skewStrength = (raw.skew_strength as number | undefined) ?? 0
    const skew: 'bullish' | 'neutral' | 'bearish' =
      skewStrength > 0.1 ? 'bullish' : skewStrength < -0.1 ? 'bearish' : 'neutral'

    return {
      distribution: dist,
      skew,
      skewStrength,
      impliedMove: { p10, p50, p90 },
      confidenceScore: (raw.confidence_score as number | undefined) ?? 50,
      generatedAt: new Date().toISOString(),
    }
  }

  private async _claudeFallback(params: ForecastParams): Promise<KronosForecast> {
    const client = new Anthropic()
    const prompt = `You are a financial forecasting model. Generate a realistic price distribution forecast for ${params.symbol} over the next ${params.horizonHours} hours using interval ${params.interval}.

Return ONLY valid JSON with this exact shape:
{
  "distribution": [{"price": number, "probability": number}, ...],
  "skew": "bullish" | "neutral" | "bearish",
  "skew_strength": number between -1 and 1,
  "p10": number,
  "p50": number,
  "p90": number,
  "confidence_score": number between 0 and 100
}
The distribution should have 10-20 points summing to probability 1.0.
Base the forecast on realistic market dynamics for this symbol.`

    try {
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = msg.content.find(b => b.type === 'text')?.text ?? '{}'
      const match = text.match(/\{[\s\S]*\}/)
      const parsed = JSON.parse(match?.[0] ?? '{}')

      const skewStrength: number = parsed.skew_strength ?? 0
      const skew: 'bullish' | 'neutral' | 'bearish' =
        parsed.skew ?? (skewStrength > 0.1 ? 'bullish' : skewStrength < -0.1 ? 'bearish' : 'neutral')

      return {
        distribution: parsed.distribution ?? [],
        skew,
        skewStrength,
        impliedMove: { p10: parsed.p10 ?? 0, p50: parsed.p50 ?? 0, p90: parsed.p90 ?? 0 },
        confidenceScore: parsed.confidence_score ?? 40,
        generatedAt: new Date().toISOString(),
      }
    } catch {
      return {
        distribution: [],
        skew: 'neutral',
        skewStrength: 0,
        impliedMove: { p10: 0, p50: 0, p90: 0 },
        confidenceScore: 20,
        generatedAt: new Date().toISOString(),
      }
    }
  }

  private _syntheticKlinesFallback(params: SyntheticKlineParams): KronosSyntheticKline[] {
    const { lengthHours, startConditions } = params
    const regimeMultiplier = startConditions.regime === 'crisis' ? 3
      : startConditions.regime === 'stress' ? 2 : 1
    const hourlyVol = (startConditions.volatility * regimeMultiplier) / Math.sqrt(8760)

    const klines: KronosSyntheticKline[] = []
    let price = 100 // normalised starting price
    const now = Date.now()

    for (let i = 0; i < lengthHours; i++) {
      const ret = (Math.random() - 0.5) * 2 * hourlyVol
      const open = price
      price = price * (1 + ret)
      const high = Math.max(open, price) * (1 + Math.random() * hourlyVol * 0.5)
      const low = Math.min(open, price) * (1 - Math.random() * hourlyVol * 0.5)
      klines.push({
        open: Math.round(open * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        close: Math.round(price * 100) / 100,
        volume: Math.round(1_000_000 * (1 + Math.random())),
        timestamp: new Date(now + i * 3_600_000).toISOString(),
      })
    }
    return klines
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const kronosClient = new KronosClient(process.env.KRONOS_BASE_URL ?? '')
