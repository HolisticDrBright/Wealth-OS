/**
 * Full signal implementations for 10 stock/options strategies.
 */

import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type { Opportunity, OpportunityContext } from '../../pipeline-types'
import { randomUUID } from 'crypto'

// ─── Shared helpers ────────────────────────────────────────────────────────────

function sma(arr: number[], period: number): number {
  const slice = arr.slice(-period)
  return slice.reduce((s, v) => s + v, 0) / slice.length
}

function stdDev(arr: number[]): number {
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length)
}

function getCloses(result: unknown): number[] {
  const r = (result as Record<string, unknown>)
  const res = (r?.chart as Record<string, unknown>)?.result as unknown[]
  if (!res?.[0]) return []
  const adj = ((res[0] as Record<string, unknown>).indicators as Record<string, unknown>)
  const ac = (adj?.adjclose as unknown[])?.[0]
  const closes = (ac as Record<string, unknown>)?.adjclose as number[] | undefined
  return closes?.filter((v): v is number => v != null) ?? []
}

function getVolumes(result: unknown): number[] {
  const r = (result as Record<string, unknown>)
  const res = (r?.chart as Record<string, unknown>)?.result as unknown[]
  if (!res?.[0]) return []
  const quote = ((res[0] as Record<string, unknown>).indicators as Record<string, unknown>)
  const q = (quote?.quote as unknown[])?.[0]
  const volumes = (q as Record<string, unknown>)?.volume as number[] | undefined
  return volumes?.filter((v): v is number => v != null) ?? []
}

async function fetchChart(ticker: string, range: string): Promise<unknown> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${range}`
  const res = await fetch(url, { signal: AbortSignal.timeout(6_000) })
  return res.json()
}

// ─── 1. QuantMomentumStrategy ──────────────────────────────────────────────────

const QM_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META', 'AMZN', 'TSLA', 'JPM', 'UNH', 'LLY', 'V', 'AVGO']

export class QuantMomentumStrategy extends BasePipelineStrategy {
  readonly key = 'quant_momentum' as const
  readonly displayName = '12-1 Quant Momentum'
  readonly assetClass = 'stocks' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    try {
      const results = await Promise.allSettled(
        QM_WATCHLIST.map(async (ticker) => {
          const data = await fetchChart(ticker, '1y')
          const closes = getCloses(data)
          if (closes.length < 23) return null
          const first = closes[0]
          const last = closes[closes.length - 1]
          const prev22 = closes[closes.length - 22]
          const ret12m = (last - first) / first
          const ret1m = (last - prev22) / prev22
          const momentum = ret12m - ret1m
          return { ticker, momentum, ret1m }
        })
      )

      const candidates = results
        .filter((r): r is PromiseFulfilledResult<{ ticker: string; momentum: number; ret1m: number } | null> =>
          r.status === 'fulfilled' && r.value !== null
        )
        .map((r) => r.value!)
        .filter((v) => v.momentum > 0.15)
        .sort((a, b) => b.momentum - a.momentum)
        .slice(0, 3)

      return candidates.map((c) => ({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: c.ticker,
        direction: 'long' as const,
        assetClass: this.assetClass,
        strength: Math.min(1, c.momentum / 0.5),
        expectedReturn: c.ret1m * 0.5,
        metadata: { momentum: c.momentum, ret1m: c.ret1m },
        detectedAt: new Date().toISOString(),
      }))
    } catch {
      return []
    }
  }
}

// ─── 2. QvmMultifactorStrategy ─────────────────────────────────────────────────

const QVM_WATCHLIST = ['MSFT', 'AAPL', 'GOOGL', 'JPM', 'JNJ', 'PG', 'KO', 'V', 'MA', 'UNH', 'HD', 'BRK-B']

export class QvmMultifactorStrategy extends BasePipelineStrategy {
  readonly key = 'qvm_multifactor' as const
  readonly displayName = 'QVM Multi-Factor'
  readonly assetClass = 'stocks' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${QVM_WATCHLIST.join(',')}`
      const res = await fetch(url, { signal: AbortSignal.timeout(6_000) })
      const data = await res.json() as Record<string, unknown>
      const items = ((data?.quoteResponse as Record<string, unknown>)?.result as unknown[]) ?? []

      const scored = items
        .map((item) => {
          const q = item as Record<string, unknown>
          const symbol = q.symbol as string
          const price = q.regularMarketPrice as number
          const high52 = q.fiftyTwoWeekHigh as number
          const low52 = q.fiftyTwoWeekLow as number
          const pe = q.trailingPE as number | undefined

          if (!price || !high52 || !low52 || high52 === low52) return null

          const priceFromLow = (price - low52) / (high52 - low52)
          const qualityScore = pe && pe > 0 && pe < 25 ? 33 : pe && pe < 35 ? 20 : 10
          const valueScore = (1 - priceFromLow) * 33
          const momScore = priceFromLow * 34
          const qvmScore = qualityScore + valueScore * 0.5 + momScore * 0.5
          return { symbol, qvmScore, priceFromLow }
        })
        .filter((v): v is { symbol: string; qvmScore: number; priceFromLow: number } =>
          v !== null && v.qvmScore > 40
        )
        .sort((a, b) => b.qvmScore - a.qvmScore)
        .slice(0, 3)

      return scored.map((c) => ({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: c.symbol,
        direction: 'long' as const,
        assetClass: this.assetClass,
        strength: Math.min(1, c.qvmScore / 70),
        expectedReturn: 0.07,
        metadata: { qvmScore: c.qvmScore, priceFromLow: c.priceFromLow },
        detectedAt: new Date().toISOString(),
      }))
    } catch {
      return []
    }
  }
}

// ─── 3. DividendAristocratStrategy ────────────────────────────────────────────

const ARISTOCRATS = ['JNJ', 'KO', 'PG', 'MMM', 'ABT', 'EMR', 'GPC', 'CL', 'T', 'MCD', 'ED', 'ADP', 'AFL']

export class DividendAristocratStrategy extends BasePipelineStrategy {
  readonly key = 'dividend_aristocrat' as const
  readonly displayName = 'Dividend Aristocrat'
  readonly assetClass = 'stocks' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ARISTOCRATS.join(',')}`
      const res = await fetch(url, { signal: AbortSignal.timeout(6_000) })
      const data = await res.json() as Record<string, unknown>
      const items = ((data?.quoteResponse as Record<string, unknown>)?.result as unknown[]) ?? []

      const candidates = items
        .map((item) => {
          const q = item as Record<string, unknown>
          const symbol = q.symbol as string
          const price = q.regularMarketPrice as number
          const high52 = q.fiftyTwoWeekHigh as number
          const dividendYield = (q.dividendYield as number | undefined) ?? 0

          if (!price || !high52) return null

          const pctFromHigh = (high52 - price) / high52
          return { symbol, pctFromHigh, dividendYield }
        })
        .filter((v): v is { symbol: string; pctFromHigh: number; dividendYield: number } =>
          v !== null && v.pctFromHigh > 0.10 && v.dividendYield > 0.02
        )
        .sort((a, b) => b.pctFromHigh - a.pctFromHigh)
        .slice(0, 3)

      return candidates.map((c) => ({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: c.symbol,
        direction: 'long' as const,
        assetClass: this.assetClass,
        strength: Math.min(1, c.pctFromHigh / 0.30),
        expectedReturn: c.pctFromHigh * 0.5 + c.dividendYield / 12,
        metadata: { pctFromHigh: c.pctFromHigh, dividendYield: c.dividendYield },
        detectedAt: new Date().toISOString(),
      }))
    } catch {
      return []
    }
  }
}

// ─── 4. SectorRotationStrategy ────────────────────────────────────────────────

const SECTOR_ETFS = ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLB', 'XLU', 'XLRE', 'XLC']

export class SectorRotationStrategy extends BasePipelineStrategy {
  readonly key = 'sector_rotation' as const
  readonly displayName = 'Sector Rotation'
  readonly assetClass = 'stocks' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    try {
      const results = await Promise.allSettled(
        SECTOR_ETFS.map(async (ticker) => {
          const data = await fetchChart(ticker, '1mo')
          const closes = getCloses(data)
          if (closes.length < 2) return null
          const return1m = (closes[closes.length - 1] - closes[0]) / closes[0]
          return { ticker, return1m }
        })
      )

      const fulfilled = results
        .filter((r): r is PromiseFulfilledResult<{ ticker: string; return1m: number } | null> =>
          r.status === 'fulfilled' && r.value !== null
        )
        .map((r) => r.value!)

      const opportunities: Opportunity[] = []

      const sorted = [...fulfilled].sort((a, b) => b.return1m - a.return1m)
      const top = sorted[0]
      const bottom = sorted[sorted.length - 1]

      if (top && top.return1m > 0.03) {
        opportunities.push({
          id: randomUUID(),
          strategyKey: this.key,
          symbol: top.ticker,
          direction: 'long',
          assetClass: this.assetClass,
          strength: Math.min(1, top.return1m / 0.10),
          expectedReturn: top.return1m * 0.3,
          metadata: { return1m: top.return1m, rank: 'top' },
          detectedAt: new Date().toISOString(),
        })
      }

      if (bottom && bottom.return1m < -0.03) {
        opportunities.push({
          id: randomUUID(),
          strategyKey: this.key,
          symbol: bottom.ticker,
          direction: 'short',
          assetClass: this.assetClass,
          strength: Math.min(1, Math.abs(bottom.return1m) / 0.10),
          expectedReturn: Math.abs(bottom.return1m) * 0.3,
          metadata: { return1m: bottom.return1m, rank: 'bottom' },
          detectedAt: new Date().toISOString(),
        })
      }

      return opportunities
    } catch {
      return []
    }
  }
}

// ─── 5. PeadStrategy ──────────────────────────────────────────────────────────

const PEAD_WATCHLIST = ['NVDA', 'META', 'AMZN', 'MSFT', 'GOOGL', 'AAPL', 'TSLA', 'AMD']

export class PeadStrategy extends BasePipelineStrategy {
  readonly key = 'pead' as const
  readonly displayName = 'Post-Earnings Announcement Drift'
  readonly assetClass = 'stocks' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    try {
      const results = await Promise.allSettled(
        PEAD_WATCHLIST.map(async (ticker) => {
          const data = await fetchChart(ticker, '60d')
          const closes = getCloses(data)
          const volumes = getVolumes(data)
          if (closes.length < 31 || volumes.length < 31) return null

          const avgVol20 = volumes.slice(0, 40).reduce((s, v) => s + v, 0) / Math.min(40, volumes.length)
          const recentCloses = closes.slice(-30)
          const recentVolumes = volumes.slice(-30)

          for (let i = 1; i < recentCloses.length; i++) {
            const vol = recentVolumes[i]
            const close = recentCloses[i]
            const prevClose = recentCloses[i - 1]
            const gapMagnitude = (close - prevClose) / prevClose

            if (vol > 2 * avgVol20 && Math.abs(gapMagnitude) > 0.05) {
              return { ticker, gapMagnitude }
            }
          }
          return null
        })
      )

      const candidates = results
        .filter((r): r is PromiseFulfilledResult<{ ticker: string; gapMagnitude: number } | null> =>
          r.status === 'fulfilled' && r.value !== null
        )
        .map((r) => r.value!)

      return candidates.map((c) => ({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: c.ticker,
        direction: (c.gapMagnitude > 0 ? 'long' : 'short') as 'long' | 'short',
        assetClass: this.assetClass,
        strength: Math.min(1, Math.abs(c.gapMagnitude) / 0.20),
        expectedReturn: Math.abs(c.gapMagnitude) * 0.25,
        metadata: { gapMagnitude: c.gapMagnitude },
        detectedAt: new Date().toISOString(),
      }))
    } catch {
      return []
    }
  }
}

// ─── 6. OptionsWheelStrategy ──────────────────────────────────────────────────

const WHEEL_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'AMD', 'TSLA', 'META', 'AMZN', 'GOOGL']

export class OptionsWheelStrategy extends BasePipelineStrategy {
  readonly key = 'options_wheel' as const
  readonly displayName = 'Options Wheel'
  readonly assetClass = 'options' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    try {
      const results = await Promise.allSettled(
        WHEEL_WATCHLIST.map(async (ticker) => {
          const data = await fetchChart(ticker, '60d')
          const closes = getCloses(data)
          if (closes.length < 31) return null

          const logReturns = closes.slice(-31).slice(1).map((c, i) => Math.log(c / closes[closes.length - 31 + i]))
          const rv = stdDev(logReturns)
          const rvAnn = rv * Math.sqrt(252)
          const sma50 = sma(closes, 50)
          const lastClose = closes[closes.length - 1]

          return { ticker, rvAnn, sma50, lastClose }
        })
      )

      const candidates = results
        .filter((r): r is PromiseFulfilledResult<{ ticker: string; rvAnn: number; sma50: number; lastClose: number } | null> =>
          r.status === 'fulfilled' && r.value !== null
        )
        .map((r) => r.value!)
        .filter((v) => v.rvAnn > 0.30 && v.rvAnn < 0.90 && v.lastClose > v.sma50)
        .sort((a, b) => b.rvAnn - a.rvAnn)
        .slice(0, 3)

      return candidates.map((c) => ({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: c.ticker,
        direction: 'neutral' as const,
        assetClass: this.assetClass,
        strength: Math.min(1, (c.rvAnn - 0.30) / 0.40),
        expectedReturn: (c.rvAnn / 52) * 0.40,
        metadata: { rvAnn: c.rvAnn, sma50: c.sma50, lastClose: c.lastClose },
        detectedAt: new Date().toISOString(),
      }))
    } catch {
      return []
    }
  }
}

// ─── 7. GammaExposureStrategy ─────────────────────────────────────────────────

export class GammaExposureStrategy extends BasePipelineStrategy {
  readonly key = 'gamma_exposure' as const
  readonly displayName = 'Gamma Exposure Hedge'
  readonly assetClass = 'options' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    try {
      const data = await fetchChart('%5EVIX', '60d')
      const closes = getCloses(data)
      if (closes.length < 2) return []

      const currentVix = closes[closes.length - 1]
      const yesterday = closes[closes.length - 2]
      const vixSma20 = sma(closes, 20)

      const sorted = [...closes].sort((a, b) => a - b)
      const idx = sorted.findIndex((v) => v >= currentVix)
      const vixPercentile = idx >= 0 ? idx / sorted.length : 1

      let direction: 'long' | 'short' = 'long'
      let strength = 0
      let expectedReturn = 0

      if (currentVix > yesterday * 1.15) {
        direction = 'long'
        strength = 0.8
        expectedReturn = 0.06
      } else if (currentVix < 16 && vixPercentile < 0.25) {
        direction = 'long'
        strength = (16 - currentVix) / 10
        expectedReturn = 0.05
      } else if (currentVix > 30 && vixPercentile > 0.75) {
        direction = 'short'
        strength = (currentVix - 30) / 20
        expectedReturn = 0.04
      } else {
        return []
      }

      return [{
        id: randomUUID(),
        strategyKey: this.key,
        symbol: 'VIX',
        direction,
        assetClass: this.assetClass,
        strength: Math.min(1, strength),
        expectedReturn,
        metadata: { currentVix, vixSma20, vixPercentile },
        detectedAt: new Date().toISOString(),
      }]
    } catch {
      return []
    }
  }
}

// ─── 8. MergerArbStrategy ─────────────────────────────────────────────────────

const DEALS = [
  { target: 'HASI', dealPrice: 36.00 },
  { target: 'SWKS', dealPrice: 105.00 },
  { target: 'MCRB', dealPrice: 6.30 },
  { target: 'ATVI', dealPrice: 95.00 },
]

export class MergerArbStrategy extends BasePipelineStrategy {
  readonly key = 'merger_arb' as const
  readonly displayName = 'Merger Arbitrage'
  readonly assetClass = 'stocks' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    try {
      const symbols = DEALS.map((d) => d.target).join(',')
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`
      const res = await fetch(url, { signal: AbortSignal.timeout(6_000) })
      const data = await res.json() as Record<string, unknown>
      const items = ((data?.quoteResponse as Record<string, unknown>)?.result as unknown[]) ?? []

      const priceMap = new Map<string, number>()
      for (const item of items) {
        const q = item as Record<string, unknown>
        priceMap.set(q.symbol as string, q.regularMarketPrice as number)
      }

      const opportunities: Opportunity[] = []
      for (const deal of DEALS) {
        const currentPrice = priceMap.get(deal.target)
        if (!currentPrice) continue

        const spread = (deal.dealPrice - currentPrice) / currentPrice
        if (spread > 0.01 && spread < 0.25) {
          opportunities.push({
            id: randomUUID(),
            strategyKey: this.key,
            symbol: deal.target,
            direction: 'long',
            assetClass: this.assetClass,
            strength: Math.min(1, spread / 0.08),
            expectedReturn: spread * 0.85,
            metadata: { dealPrice: deal.dealPrice, currentPrice, spread },
            detectedAt: new Date().toISOString(),
          })
        }
      }

      return opportunities
    } catch {
      return []
    }
  }
}

// ─── 9. SpinoffStrategy ───────────────────────────────────────────────────────

const SPINOFFS = [
  { ticker: 'GEV', spinoffDate: '2024-04-02' },
  { ticker: 'KVUE', spinoffDate: '2023-05-04' },
  { ticker: 'GEHC', spinoffDate: '2023-01-03' },
  { ticker: 'SOLV', spinoffDate: '2024-10-01' },
]

export class SpinoffStrategy extends BasePipelineStrategy {
  readonly key = 'spinoff' as const
  readonly displayName = 'Spinoff Alpha'
  readonly assetClass = 'stocks' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    try {
      const results = await Promise.allSettled(
        SPINOFFS.map(async ({ ticker, spinoffDate }) => {
          const daysSinceSpinoff = (Date.now() - new Date(spinoffDate).getTime()) / 86400000
          if (daysSinceSpinoff >= 180) return null

          const data = await fetchChart(ticker, '60d')
          const closes = getCloses(data)
          if (closes.length < 11) return null

          const lastClose = closes[closes.length - 1]
          const returnSince = (lastClose - closes[0]) / closes[0]
          const recentMom = (lastClose - closes[closes.length - 10]) / closes[closes.length - 10]

          if (returnSince < 0 && recentMom > 0.02) {
            return { ticker, returnSince, recentMom, daysSinceSpinoff }
          }
          return null
        })
      )

      const candidates = results
        .filter((r): r is PromiseFulfilledResult<{ ticker: string; returnSince: number; recentMom: number; daysSinceSpinoff: number } | null> =>
          r.status === 'fulfilled' && r.value !== null
        )
        .map((r) => r.value!)

      return candidates.map((c) => ({
        id: randomUUID(),
        strategyKey: this.key,
        symbol: c.ticker,
        direction: 'long' as const,
        assetClass: this.assetClass,
        strength: Math.min(1, Math.abs(c.returnSince) / 0.30),
        expectedReturn: Math.abs(c.returnSince) * 0.4,
        metadata: { returnSince: c.returnSince, recentMom: c.recentMom, daysSinceSpinoff: c.daysSinceSpinoff },
        detectedAt: new Date().toISOString(),
      }))
    } catch {
      return []
    }
  }
}

// ─── 10. TailRiskHedgingStrategy ──────────────────────────────────────────────

export class TailRiskHedgingStrategy extends BasePipelineStrategy {
  readonly key = 'tail_risk_hedging' as const
  readonly displayName = 'Tail Risk Hedging'
  readonly assetClass = 'options' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    try {
      const [vixResult, spyResult] = await Promise.allSettled([
        fetchChart('%5EVIX', '30d'),
        fetchChart('SPY', '30d'),
      ])

      if (vixResult.status === 'rejected' || spyResult.status === 'rejected') return []

      const vixCloses = getCloses(vixResult.value)
      const spyCloses = getCloses(spyResult.value)

      if (vixCloses.length < 2 || spyCloses.length < 2) return []

      const currentVix = vixCloses[vixCloses.length - 1]
      const vixSma30 = sma(vixCloses, 30)
      const spyFirst = spyCloses[0]
      const spyLast = spyCloses[spyCloses.length - 1]
      const spyReturn30d = (spyLast - spyFirst) / spyFirst
      const vixContango = currentVix < vixSma30

      if (currentVix < 15 && spyReturn30d > 0.05 && vixContango) {
        return [{
          id: randomUUID(),
          strategyKey: this.key,
          symbol: 'SPY-PUT-TAIL',
          direction: 'long',
          assetClass: this.assetClass,
          strength: Math.min(1, (15 - currentVix) / 8),
          expectedReturn: 0.15,
          metadata: { currentVix, vixSma30, spyReturn30d, vixContango },
          detectedAt: new Date().toISOString(),
        }]
      }

      if (currentVix > 35) {
        return [{
          id: randomUUID(),
          strategyKey: this.key,
          symbol: 'VIX-SHORT',
          direction: 'short',
          assetClass: this.assetClass,
          strength: Math.min(1, (currentVix - 35) / 15),
          expectedReturn: 0.08,
          metadata: { currentVix, vixSma30, spyReturn30d, vixContango },
          detectedAt: new Date().toISOString(),
        }]
      }

      return []
    } catch {
      return []
    }
  }
}

// AutopilotCongressionalStrategy moved to ./autopilot-congressional.ts
