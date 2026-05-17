/**
 * Full signal implementations for all 9 forex/multi-asset strategies.
 * Candle data: OANDA v20 when configured, Yahoo Finance free fallback otherwise.
 */

import { BasePipelineStrategy } from '../../BasePipelineStrategy'
import type { Opportunity, OpportunityContext } from '../../pipeline-types'
import { randomUUID } from 'crypto'
import { getCandles, getBidAsk } from '../../../oanda-client'
import type { OandaCandle } from '../../../oanda-client'
import {
  isFridayEod,
  isFridayAfter5pmEt,
  isInKillZone,
  currentKillZone,
  isNyCloseWindow,
  isHighImpactNewsDay,
  isLondonOpen,
  hourEt,
  minuteEt,
} from '../../cadence-helpers'

// ─── Math helpers ─────────────────────────────────────────────────────────────

function smaOf(values: number[], period: number): number {
  const slice = values.slice(-period)
  return slice.reduce((s, v) => s + v, 0) / slice.length
}

function stdDevOf(arr: number[]): number {
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length)
}

function atr14(candles: OandaCandle[]): number {
  if (candles.length < 2) return 0.001
  const trs = candles.slice(1).map((c, i) => {
    const prev = candles[i]
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close))
  })
  const recent = trs.slice(-14)
  return recent.reduce((s, v) => s + v, 0) / recent.length
}

function logReturns(closes: number[]): number[] {
  return closes.slice(1).map((c, i) => Math.log(c / closes[i]))
}

function corrOf(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 10) return 0
  const ax = a.slice(-n), bx = b.slice(-n)
  const ma = ax.reduce((s, v) => s + v, 0) / n
  const mb = bx.reduce((s, v) => s + v, 0) / n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) {
    num += (ax[i] - ma) * (bx[i] - mb)
    da += (ax[i] - ma) ** 2
    db += (bx[i] - mb) ** 2
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}

// ─── 1. IctSmcStrategy ────────────────────────────────────────────────────────

export class IctSmcStrategy extends BasePipelineStrategy {
  readonly key = 'ict_smc' as const
  readonly displayName = 'ICT Smart Money Concepts'
  readonly assetClass = 'forex' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {

    if (!isInKillZone()) return []

    const results: Opportunity[] = []

    for (const pair of ['EUR_USD', 'GBP_USD']) {
      try {
        const candles = await getCandles(pair, 'M5', 60)
        if (candles.length < 20) continue

        const pipSize = pair.includes('JPY') ? 0.01 : 0.0001
        const atrVal = atr14(candles)

        // Swing high/low in preceding 12 candles (exclude last 2)
        const lookback = candles.slice(-14, -2)
        const swingHigh = Math.max(...lookback.map(c => c.high))
        const swingLow  = Math.min(...lookback.map(c => c.low))

        const prev = candles[candles.length - 2]
        const last = candles[candles.length - 1]

        const sweptHigh = prev.high > swingHigh && last.close < swingHigh
        const sweptLow  = prev.low  < swingLow  && last.close > swingLow
        if (!sweptHigh && !sweptLow) continue

        // Displacement: last candle body > 1× ATR
        const body = Math.abs(last.close - last.open)
        if (body < atrVal) continue

        const direction: 'long' | 'short' = sweptHigh ? 'short' : 'long'

        // FVG in last 5 candles
        let fvgMidpoint = last.close
        let fvgFound = false
        for (let i = Math.max(1, candles.length - 5); i < candles.length - 1; i++) {
          const a = candles[i - 1], c = candles[i + 1]
          if (direction === 'long'  && c.low  > a.high) { fvgFound = true; fvgMidpoint = (c.low  + a.high) / 2; break }
          if (direction === 'short' && c.high < a.low)  { fvgFound = true; fvgMidpoint = (c.high + a.low)  / 2; break }
        }
        if (!fvgFound) continue

        const stopPrice = direction === 'short' ? swingHigh + 2 * pipSize : swingLow - 2 * pipSize
        const target1   = direction === 'short' ? fvgMidpoint - 2.5 * atrVal : fvgMidpoint + 2.5 * atrVal

        results.push({
          id: randomUUID(),
          strategyKey: this.key,
          symbol: pair,
          direction,
          assetClass: this.assetClass,
          strength: Math.min(1, body / atrVal * 0.5),
          expectedReturn: 0.025,
          metadata: {
            stopPrice,
            target1,
            killZone: currentKillZone(),
            reasoning: `${currentKillZone()} ${sweptHigh ? 'high sweep' : 'low sweep'} + ${(body/atrVal).toFixed(1)}× ATR displacement + FVG at ${fvgMidpoint.toFixed(5)}`,
          },
          detectedAt: new Date().toISOString(),
        })
      } catch { /* skip pair */ }
    }
    return results
  }
}

// ─── 2. CarryTradeStrategy ────────────────────────────────────────────────────

// Approximate G10 real rates (nominal rate − CPI). Updated Q2 2026.
const G10_REAL_RATES: Record<string, number> = {
  USD: 1.5, EUR: 0.8, JPY: -0.8, GBP: 1.6, CHF: -0.2,
  CAD: 1.1, AUD: 0.9, NZD: 1.1, SEK: 0.3, NOK: 1.2,
}

// OANDA instrument for long_ccy/short_ccy pair (only tradeable combos)
const CARRY_PAIR_MAP: Record<string, string> = {
  'AUD_JPY': 'AUD_JPY', 'NZD_JPY': 'NZD_JPY', 'GBP_JPY': 'GBP_JPY',
  'USD_JPY': 'USD_JPY', 'CAD_JPY': 'CAD_JPY', 'AUD_CHF': 'AUD_CHF',
  'NZD_CHF': 'NZD_CHF', 'CAD_CHF': 'CAD_CHF', 'NOK_CHF': 'USD_NOK', // proxy
  'EUR_CHF': 'EUR_CHF',
}

export class CarryTradeStrategy extends BasePipelineStrategy {
  readonly key = 'carry_trade' as const
  readonly displayName = 'Carry Trade'
  readonly assetClass = 'forex' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {

    if (!isFridayEod()) return []

    try {
      // Risk-off filter via Yahoo Finance VIX
      const vixRes = await fetch(
        'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d',
        { signal: AbortSignal.timeout(6_000) }
      ).catch(() => null)
      if (vixRes?.ok) {
        const vd = await vixRes.json() as Record<string, unknown>
        const result = ((vd?.chart as Record<string, unknown>)?.result as unknown[])?.[0]
        const ac = (((result as Record<string, unknown>)?.indicators as Record<string, unknown>)?.adjclose as unknown[])?.[0]
        const closes = (ac as Record<string, unknown>)?.adjclose as number[] | undefined
        const vixNow = closes?.filter(Boolean).at(-1)
        if (vixNow && vixNow > 25) return []
      }

      const ranked = Object.entries(G10_REAL_RATES).sort((a, b) => b[1] - a[1])
      const longs  = ranked.slice(0, 2).map(([c]) => c)
      const shorts = ranked.slice(-2).map(([c]) => c)

      const results: Opportunity[] = []
      for (const longCcy of longs) {
        for (const shortCcy of shorts) {
          const oandaPair = CARRY_PAIR_MAP[`${longCcy}_${shortCcy}`]
          if (!oandaPair) continue

          const candles = await getCandles(oandaPair, 'D', 35).catch(() => [] as OandaCandle[])
          if (candles.length < 20) continue

          const vol = stdDevOf(logReturns(candles.map(c => c.close))) * Math.sqrt(252)
          const sizeHint = Math.min(0.25, Math.max(0.05, 0.1 / (vol || 0.1)))
          const carry = G10_REAL_RATES[longCcy] - G10_REAL_RATES[shortCcy]

          results.push({
            id: randomUUID(),
            strategyKey: this.key,
            symbol: oandaPair,
            direction: 'long',
            assetClass: this.assetClass,
            strength: 0.6,
            expectedReturn: carry / 100,
            metadata: {
              longCcy, shortCcy,
              carrySpread: carry,
              annualizedVol: +vol.toFixed(4),
              sizeHint,
              reasoning: `Carry: long ${longCcy} (${G10_REAL_RATES[longCcy]}%) vs ${shortCcy} (${G10_REAL_RATES[shortCcy]}%), VIX < 25`,
            },
            detectedAt: new Date().toISOString(),
          })
        }
      }
      return results
    } catch { return [] }
  }
}

// ─── 3. CotPositioningStrategy ────────────────────────────────────────────────

const COT_MARKETS = [
  { oandaPair: 'EUR_USD', cftcName: 'EURO FX - CHICAGO MERCANTILE EXCHANGE' },
  { oandaPair: 'GBP_USD', cftcName: 'BRITISH POUND STERLING - CHICAGO MERCANTILE EXCHANGE' },
]

export class CotPositioningStrategy extends BasePipelineStrategy {
  readonly key = 'cot_positioning' as const
  readonly displayName = 'COT Positioning'
  readonly assetClass = 'forex' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {
    if (!isFridayAfter5pmEt()) return []

    const results: Opportunity[] = []

    for (const mkt of COT_MARKETS) {
      try {
        const params = new URLSearchParams({
          '$filter': `Market_and_Exchange_Names eq '${mkt.cftcName}'`,
          '$top': '160',
          '$orderby': 'Report_Date_as_YYYY_MM_DD desc',
        })
        const url = `https://publicreporting.cftc.gov/api/odata/v1/MarketsandFinancialDataPublicReportingAPI/?${params.toString()}`
        const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
        if (!res.ok) continue

        const data = await res.json() as { value: Array<Record<string, unknown>> }
        const rows = data.value ?? []
        if (rows.length < 52) continue

        const nets = rows.map(r =>
          (r.NonComm_Positions_Long_All as number) - (r.NonComm_Positions_Short_All as number)
        )
        const current = nets[0]
        const max = Math.max(...nets), min = Math.min(...nets)
        const range = max - min
        const cotIndex = range > 0 ? ((current - min) / range) * 100 : 50

        if (cotIndex > 90 || cotIndex < 10) {
          const direction: 'long' | 'short' = cotIndex < 10 ? 'long' : 'short'
          results.push({
            id: randomUUID(),
            strategyKey: this.key,
            symbol: mkt.oandaPair,
            direction,
            assetClass: this.assetClass,
            strength: Math.min(1, Math.abs(cotIndex - 50) / 50),
            expectedReturn: 0.03,
            metadata: {
              cotIndex: Math.round(cotIndex),
              netNonComm: current,
              reasoning: `COT Index ${cotIndex.toFixed(0)} — ${cotIndex < 10 ? 'extreme shorts → buy' : 'extreme longs → fade'}`,
            },
            detectedAt: new Date().toISOString(),
          })
        }
      } catch { /* skip market */ }
    }
    return results
  }
}

// ─── 4. CbDivergenceStrategy ──────────────────────────────────────────────────

type CbKey = 'FED' | 'ECB' | 'BOE' | 'BOJ'
const CB_MEETINGS_2026: Record<CbKey, Array<[number, number]>> = {
  FED: [[1,29],[3,19],[5,7],[6,18],[7,30],[9,17],[11,5],[12,17]],
  ECB: [[1,30],[3,6],[4,17],[6,5],[7,24],[9,11],[10,30],[12,18]],
  BOE: [[2,6],[3,20],[5,8],[6,19],[8,7],[9,18],[11,6],[12,18]],
  BOJ: [[1,24],[3,19],[4,30],[6,17],[7,31],[9,22],[10,29],[12,19]],
}
// Positive = hawkish, negative = dovish. Update manually each quarter.
const CB_STANCE: Record<string, number> = { USD: 2, EUR: -1, GBP: 1, JPY: -2 }

function hasCbMeetingWithin7Days(): boolean {
  const now = Date.now()
  return (Object.values(CB_MEETINGS_2026) as Array<Array<[number, number]>>)
    .flat()
    .some(([m, d]) => {
      const t = new Date(new Date().getFullYear(), m - 1, d).getTime()
      const diff = (t - now) / 86_400_000
      return diff >= 0 && diff <= 7
    })
}

export class CbDivergenceStrategy extends BasePipelineStrategy {
  readonly key = 'cb_divergence' as const
  readonly displayName = 'Central Bank Divergence'
  readonly assetClass = 'forex' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {

    if (!hasCbMeetingWithin7Days()) return []

    try {
      const pairDefs = [
        { oandaPair: 'EUR_USD', baseCcy: 'EUR', quoteCcy: 'USD' },
        { oandaPair: 'GBP_USD', baseCcy: 'GBP', quoteCcy: 'USD' },
        { oandaPair: 'USD_JPY', baseCcy: 'USD', quoteCcy: 'JPY' },
        { oandaPair: 'GBP_JPY', baseCcy: 'GBP', quoteCcy: 'JPY' },
      ]

      const opportunities: Opportunity[] = []
      for (const { oandaPair, baseCcy, quoteCcy } of pairDefs) {
        const baseStance  = CB_STANCE[baseCcy]
        const quoteStance = CB_STANCE[quoteCcy]
        if (baseStance === undefined || quoteStance === undefined) continue
        const div = baseStance - quoteStance
        if (Math.abs(div) < 2) continue
        const direction: 'long' | 'short' = div > 0 ? 'long' : 'short'
        opportunities.push({
          id: randomUUID(),
          strategyKey: this.key,
          symbol: oandaPair,
          direction,
          assetClass: this.assetClass,
          strength: Math.min(1, Math.abs(div) / 4),
          expectedReturn: 0.025,
          metadata: {
            baseCcy, quoteCcy,
            baseStance, quoteStance,
            divergence: div,
            reasoning: `${baseCcy} stance ${baseStance} vs ${quoteCcy} stance ${quoteStance}, CB meeting within 7 days`,
          },
          detectedAt: new Date().toISOString(),
        })
      }
      return opportunities
    } catch { return [] }
  }
}

// ─── 5. SessionBreakoutStrategy ──────────────────────────────────────────────

export class SessionBreakoutStrategy extends BasePipelineStrategy {
  readonly key = 'session_breakout' as const
  readonly displayName = 'Session Range Breakout'
  readonly assetClass = 'forex' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {

    if (!isLondonOpen(15)) return []
    if (isHighImpactNewsDay()) return []

    const results: Opportunity[] = []

    for (const pair of ['EUR_USD', 'GBP_USD']) {
      try {
        const pipSize = pair.includes('JPY') ? 0.01 : 0.0001

        // H1 candles: use first 8 bars as Asia session proxy
        const h1 = await getCandles(pair, 'H1', 24)
        if (h1.length < 8) continue
        const asia = h1.slice(0, 8)
        const asiaHigh = Math.max(...asia.map(c => c.high))
        const asiaLow  = Math.min(...asia.map(c => c.low))
        const rangePips = (asiaHigh - asiaLow) / pipSize
        if (rangePips < 30 || rangePips > 80) continue

        // D1 20-SMA for bias
        const d1 = await getCandles(pair, 'D', 25)
        if (d1.length < 20) continue
        const sma20d = smaOf(d1.map(c => c.close), 20)

        // M5 last close for breakout check
        const m5 = await getCandles(pair, 'M5', 5)
        if (m5.length === 0) continue
        const lastM5 = m5[m5.length - 1]

        const bias: 'long' | 'short' = lastM5.close > sma20d ? 'long' : 'short'
        let dir: 'long' | 'short' | null = null
        if (lastM5.close > asiaHigh) dir = 'long'
        else if (lastM5.close < asiaLow) dir = 'short'
        if (!dir || dir !== bias) continue

        const stopPrice = dir === 'long' ? asiaLow : asiaHigh
        const target1   = dir === 'long'
          ? lastM5.close + rangePips * pipSize
          : lastM5.close - rangePips * pipSize

        results.push({
          id: randomUUID(),
          strategyKey: this.key,
          symbol: pair,
          direction: dir,
          assetClass: this.assetClass,
          strength: 0.65,
          expectedReturn: 0.015,
          metadata: {
            asiaHigh, asiaLow, rangePips: Math.round(rangePips),
            stopPrice, target1, sma20d,
            reasoning: `Asia range ${Math.round(rangePips)}p, ${dir} breakout at ${lastM5.close.toFixed(5)}, aligned with daily ${bias} bias`,
          },
          detectedAt: new Date().toISOString(),
        })
      } catch { /* skip pair */ }
    }
    return results
  }
}

// ─── 6. FxTrendfollowingStrategy ─────────────────────────────────────────────

const FX_UNIVERSE = ['EUR_USD', 'GBP_USD', 'USD_JPY', 'AUD_USD', 'USD_CAD']

export class FxTrendfollowingStrategy extends BasePipelineStrategy {
  readonly key = 'fx_trendfollowing' as const
  readonly displayName = 'FX Trend Following'
  readonly assetClass = 'forex' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {

    if (!isNyCloseWindow()) return []

    const results: Opportunity[] = []

    for (const pair of FX_UNIVERSE) {
      try {
        const candles = await getCandles(pair, 'D', 210)
        if (candles.length < 210) continue
        const closes = candles.map(c => c.close)
        const n = closes.length

        const sma50  = smaOf(closes, 50)
        const sma200 = smaOf(closes, 200)
        const sma50p = smaOf(closes.slice(0, -1), 50)
        const sma200p= smaOf(closes.slice(0, -1), 200)

        const don55Hi = Math.max(...closes.slice(-56, -1))
        const don55Lo = Math.min(...closes.slice(-56, -1))
        const today = closes[n - 1], yesterday = closes[n - 2]

        const goldenCross = sma50  > sma200  && sma50p <= sma200p
        const deathCross  = sma50  < sma200  && sma50p >= sma200p
        const upBreak     = today  > don55Hi && yesterday <= don55Hi
        const downBreak   = today  < don55Lo && yesterday >= don55Lo

        let dir: 'long' | 'short' | null = null
        let signalType = ''
        if      (goldenCross) { dir = 'long';  signalType = 'golden cross' }
        else if (deathCross)  { dir = 'short'; signalType = 'death cross'  }
        else if (upBreak)     { dir = 'long';  signalType = 'Donchian55 break'    }
        else if (downBreak)   { dir = 'short'; signalType = 'Donchian55 breakdown' }
        if (!dir) continue

        const atrVal = atr14(candles)
        const stopPrice = dir === 'long' ? today - 2.5 * atrVal : today + 2.5 * atrVal

        results.push({
          id: randomUUID(),
          strategyKey: this.key,
          symbol: pair,
          direction: dir,
          assetClass: this.assetClass,
          strength: (goldenCross || deathCross) ? 0.7 : 0.5,
          expectedReturn: (goldenCross || deathCross) ? 0.04 : 0.03,
          metadata: {
            signalType, stopPrice,
            sma50: +sma50.toFixed(5), sma200: +sma200.toFixed(5),
            atr: +atrVal.toFixed(5),
            reasoning: `${pair} ${signalType} ${dir} at NY close`,
          },
          detectedAt: new Date().toISOString(),
        })
      } catch { /* skip pair */ }
    }
    return results
  }
}

// ─── 7. MacroNewsEventStrategy ────────────────────────────────────────────────

export class MacroNewsEventStrategy extends BasePipelineStrategy {
  readonly key = 'macro_news_event' as const
  readonly displayName = 'Macro News Event Momentum'
  readonly assetClass = 'forex' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {

    if (!isHighImpactNewsDay()) return []
    // Post-release window: 8:35–10:30 ET
    const totalMin = hourEt() * 60 + minuteEt()
    if (totalMin < 8 * 60 + 35 || totalMin > 10 * 60 + 30) return []

    const results: Opportunity[] = []

    for (const pair of ['EUR_USD', 'GBP_USD']) {
      try {
        const candles = await getCandles(pair, 'M5', 20)
        if (candles.length < 12) continue

        const atrVal   = atr14(candles)
        const preClose = candles[candles.length - 10].close
        const post5    = candles[candles.length - 8].close
        const post10   = candles[candles.length - 6].close
        const current  = candles[candles.length - 1].close

        const initDir: 'long' | 'short' = post5 > preClose ? 'long' : 'short'
        const confirmed = initDir === 'long' ? post10 > post5 : post10 < post5
        if (!confirmed) continue

        const movePct = Math.abs(post5 - preClose) / preClose
        if (movePct < 0.002) continue  // need at least 20-pip move

        results.push({
          id: randomUUID(),
          strategyKey: this.key,
          symbol: pair,
          direction: initDir,
          assetClass: this.assetClass,
          strength: Math.min(1, movePct / 0.003),
          expectedReturn: 0.020,
          metadata: {
            stopPrice: preClose,
            target1: initDir === 'long' ? current + 1.5 * atrVal : current - 1.5 * atrVal,
            movePct: +movePct.toFixed(5),
            reasoning: `High-impact release: ${pair} moved ${(movePct * 100).toFixed(2)}% ${initDir}, second candle confirmed`,
          },
          detectedAt: new Date().toISOString(),
        })
      } catch { /* skip pair */ }
    }
    return results
  }
}

// ─── 8. TriangularArbStrategy ─────────────────────────────────────────────────

export class TriangularArbStrategy extends BasePipelineStrategy {
  readonly key = 'triangular_arb' as const
  readonly displayName = 'Triangular Arbitrage'
  readonly assetClass = 'forex' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {

    try {
      const [eurusd, gbpusd, eurgbp] = await Promise.all([
        getBidAsk('EUR_USD'),
        getBidAsk('GBP_USD'),
        getBidAsk('EUR_GBP'),
      ])
      if (!eurusd || !gbpusd || !eurgbp) return []

      const impliedAsk = eurusd.ask / gbpusd.bid
      const impliedBid = eurusd.bid / gbpusd.ask
      const spreadAvg  = ((eurusd.ask - eurusd.bid) + (gbpusd.ask - gbpusd.bid) + (eurgbp.ask - eurgbp.bid)) / 3
      const threshold  = 5 * spreadAvg + 0.00002

      if (eurgbp.ask > impliedAsk + threshold) {
        const profitPips = (eurgbp.ask - impliedAsk) / 0.0001
        return [{
          id: randomUUID(),
          strategyKey: this.key,
          symbol: 'EUR_GBP',
          direction: 'short',
          assetClass: this.assetClass,
          strength: Math.min(0.92, Math.max(0.70, (eurgbp.ask - impliedAsk - threshold) / threshold)),
          expectedReturn: 0.003,
          metadata: {
            legs: [
              { pair: 'EUR_USD', side: 'buy',  price: eurusd.ask },
              { pair: 'GBP_USD', side: 'sell', price: gbpusd.bid },
              { pair: 'EUR_GBP', side: 'sell', price: eurgbp.ask },
            ],
            impliedAsk, quotedAsk: eurgbp.ask,
            profitPips: +profitPips.toFixed(2),
            reasoning: `Tri-arb: EUR_GBP quoted ${eurgbp.ask.toFixed(5)} > implied ${impliedAsk.toFixed(5)}, ${profitPips.toFixed(1)}p profit`,
          },
          detectedAt: new Date().toISOString(),
        }]
      }

      if (eurgbp.bid < impliedBid - threshold) {
        const profitPips = (impliedBid - eurgbp.bid) / 0.0001
        return [{
          id: randomUUID(),
          strategyKey: this.key,
          symbol: 'EUR_GBP',
          direction: 'long',
          assetClass: this.assetClass,
          strength: Math.min(0.92, Math.max(0.70, (impliedBid - eurgbp.bid - threshold) / threshold)),
          expectedReturn: 0.003,
          metadata: {
            legs: [
              { pair: 'EUR_USD', side: 'sell', price: eurusd.bid },
              { pair: 'GBP_USD', side: 'buy',  price: gbpusd.ask },
              { pair: 'EUR_GBP', side: 'buy',  price: eurgbp.bid },
            ],
            impliedBid, quotedBid: eurgbp.bid,
            profitPips: +profitPips.toFixed(2),
            reasoning: `Tri-arb: EUR_GBP quoted ${eurgbp.bid.toFixed(5)} < implied ${impliedBid.toFixed(5)}, ${profitPips.toFixed(1)}p profit`,
          },
          detectedAt: new Date().toISOString(),
        }]
      }
      return []
    } catch { return [] }
  }
}

// ─── 9. CorrelationDivergenceStrategy ────────────────────────────────────────

const CORR_PAIRS: Array<[string, string]> = [
  ['EUR_USD', 'GBP_USD'],
  ['AUD_USD', 'NZD_USD'],
  ['USD_CAD', 'USD_NOK'],
]

export class CorrelationDivergenceStrategy extends BasePipelineStrategy {
  readonly key = 'correlation_divergence' as const
  readonly displayName = 'Correlation Divergence'
  readonly assetClass = 'multi-asset' as const

  async detectOpportunities(_ctx: OpportunityContext): Promise<Opportunity[]> {

    if (!isNyCloseWindow()) return []

    const results: Opportunity[] = []

    for (const [pairA, pairB] of CORR_PAIRS) {
      try {
        const [cA, cB] = await Promise.all([
          getCandles(pairA, 'D', 95),
          getCandles(pairB, 'D', 95),
        ])
        if (cA.length < 90 || cB.length < 90) continue

        const closesA = cA.map(c => c.close)
        const closesB = cB.map(c => c.close)

        const corr = corrOf(logReturns(closesA.slice(-91)), logReturns(closesB.slice(-91)))
        if (corr < 0.70) continue

        const ratios = closesA.slice(-60).map((a, i) => a / closesB[closesB.length - 60 + i])
        const ratioMean  = ratios.reduce((s, v) => s + v, 0) / ratios.length
        const ratioStdev = stdDevOf(ratios)
        if (ratioStdev === 0) continue

        const currentRatio = closesA.at(-1)! / closesB.at(-1)!
        const z = (currentRatio - ratioMean) / ratioStdev
        if (Math.abs(z) < 1.8 || Math.abs(z) > 3.0) continue

        const strength = Math.max(0.40, Math.min(1, (Math.abs(z) - 1.5) / 1.5))
        const meta = { z: +z.toFixed(2), corr: +corr.toFixed(2), ratioMean, ratioStdev, reasoning: `${pairA}/${pairB} z=${z.toFixed(2)}, corr=${corr.toFixed(2)}` }

        const [dirA, dirB]: Array<'long' | 'short'> = z > 0 ? ['short', 'long'] : ['long', 'short']

        results.push(
          { id: randomUUID(), strategyKey: this.key, symbol: pairA, direction: dirA, assetClass: this.assetClass, strength, expectedReturn: 0.025, metadata: meta, detectedAt: new Date().toISOString() },
          { id: randomUUID(), strategyKey: this.key, symbol: pairB, direction: dirB, assetClass: this.assetClass, strength, expectedReturn: 0.025, metadata: meta, detectedAt: new Date().toISOString() },
        )
      } catch { /* skip pair */ }
    }
    return results
  }
}
