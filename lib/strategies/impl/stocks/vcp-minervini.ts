/**
 * VCP Minervini — Volatility Contraction Pattern
 *
 * Edge: technical. MiroFish: skip. Kronos: high (blocks on opposing skew).
 * Broker: Alpaca (US retail stocks).
 *
 * Signal logic: price forms increasingly tight consolidation bases above rising
 * 200-day MA, volume contracts during base, expansion on breakout day.
 */

import type { PriceBar } from '@/lib/backtester'
import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type { Opportunity, OpportunityContext } from '../../pipeline-types'
import { randomUUID } from 'crypto'

// ─── Price helpers ─────────────────────────────────────────────────────────────

function sma(bars: PriceBar[], period: number): number {
  const s = bars.slice(-period)
  return s.reduce((a, b) => a + b.close, 0) / s.length
}

function avgVol(bars: PriceBar[], period: number): number {
  const s = bars.slice(-period)
  return s.reduce((a, b) => a + (b.volume ?? 0), 0) / s.length
}

function highRange(bars: PriceBar[], period: number): number {
  const s = bars.slice(-period)
  return Math.max(...s.map(b => b.high)) - Math.min(...s.map(b => b.low))
}

// ─── Strategy ─────────────────────────────────────────────────────────────────

export class VcpMinerviniStrategy extends BasePipelineStrategy {
  readonly key = 'vcp_minervini' as const
  readonly displayName = 'VCP Minervini'
  readonly assetClass = 'stocks' as const

  readonly minBars = 200

  async detectOpportunities(ctx: OpportunityContext): Promise<Opportunity[]> {
    const bars = ctx.bars ?? []
    if (bars.length < this.minBars) return []

    const symbol = (ctx.metadata?.symbol as string | undefined) ?? 'UNKNOWN'
    const last = bars[bars.length - 1]

    const ma50  = sma(bars, 50)
    const ma150 = sma(bars, 150)
    const ma200 = sma(bars, 200)

    // Minervini Stage 2 uptrend conditions
    const inUptrend =
      last.close > ma50 &&
      ma50 > ma150 &&
      ma150 > ma200 &&
      last.close > ma200 * 1.05  // at least 5% above 200MA

    if (!inUptrend) return []

    // VCP contraction: recent 10-bar range < prior 20-bar range (tightening)
    const range10 = highRange(bars, 10)
    const range20 = highRange(bars.slice(0, -10), 20)
    const contracting = range10 < range20 * 0.7

    if (!contracting) return []

    // Breakout on above-average volume
    const volAvg50 = avgVol(bars, 50)
    const lastVol = last.volume ?? 0
    const breakout = last.close > sma(bars.slice(0, -1), 10) && lastVol > volAvg50 * 1.5

    if (!breakout) return []

    const strength = volAvg50 > 0 ? Math.min(1, lastVol / volAvg50 / 2) : 0
    const expectedReturn = (last.close - sma(bars, 50)) / sma(bars, 50) * 0.5  // 50% of distance to MA

    return [{
      id: randomUUID(),
      strategyKey: this.key,
      symbol,
      direction: 'long',
      assetClass: this.assetClass,
      strength,
      expectedReturn: Math.abs(expectedReturn),
      metadata: { ma50, ma200, volRatio: volAvg50 > 0 ? lastVol / volAvg50 : 0, range10, range20 },
      detectedAt: new Date().toISOString(),
    }]
  }
}
