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
import type { Opportunity, OpportunityContext, OpenPosition, PriceTick, ManageAction } from '../../pipeline-types'
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

    // Bracket: -8% stop (broker-side), +10% TP1. Last third trailed via manageOpenPosition.
    const entryPrice = last.close
    const stopPrice  = entryPrice * 0.92   // -8%
    const tp1Price   = entryPrice * 1.10   // +10%

    return [{
      id: randomUUID(),
      strategyKey: this.key,
      symbol,
      direction: 'long',
      assetClass: this.assetClass,
      strength,
      expectedReturn: Math.abs(expectedReturn),
      metadata: { ma50, ma200, volRatio: volAvg50 > 0 ? lastVol / volAvg50 : 0, range10, range20, entryPrice },
      detectedAt: new Date().toISOString(),
      bracket: {
        stopPrice,
        takeProfitPrice: tp1Price,
      },
    }]
  }

  /**
   * Dynamic trailing: once position is up >10% (TP1 hit), trail last 1/3 on the 10-DMA.
   * Position monitor calls this; broker bracket already handles the -8% stop and initial TP1.
   */
  async manageOpenPosition(
    position: OpenPosition,
    tick: PriceTick
  ): Promise<ManageAction> {
    const pnlPct = position.entryPrice > 0
      ? (tick.price - position.entryPrice) / position.entryPrice
      : 0

    // If below entry by 8% and broker stop failed (latency), close immediately
    if (pnlPct <= -0.08) {
      return { type: 'close', reason: 'stop-loss -8% (broker-side backup)' }
    }

    // Trail stop logic: once TP1 level exceeded, trail on 10-DMA approximation
    // We approximate 10-DMA as a rolling price reference stored in metadata.
    // A real implementation reads historical bars; here we use entry * 1.05 as proxy
    // until the position monitor wires in bar data.
    if (pnlPct >= 0.10) {
      const trailStop = position.entryPrice * 1.05  // minimum trail: breakeven + 5%
      if (tick.price < trailStop) {
        return { type: 'close', reason: `trailing 10-DMA stop at ${trailStop.toFixed(2)}` }
      }
      // Adjust the active stop upward
      const newStop = tick.price * 0.94  // trail at -6% of current price
      if (position.metadata.trailStop == null || (position.metadata.trailStop as number) < newStop) {
        return { type: 'adjustStop', newStop, reason: `VCP trail stop raised to ${newStop.toFixed(2)}` }
      }
    }

    // Hard timeout: 90 calendar days
    const holdDays = (Date.now() - position.openedAt) / 86_400_000
    if (holdDays >= 90) {
      return { type: 'close', reason: '90-day VCP timeout' }
    }

    return { type: 'hold' }
  }
}
