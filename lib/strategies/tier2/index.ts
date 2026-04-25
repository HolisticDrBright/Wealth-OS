/**
 * Tier 2 strategies — high-conviction, deploy after Tier 1 Sharpe > 1.5.
 *
 * 1. vcp_minervini       — Volatility Contraction Pattern (Mark Minervini)
 * 2. quant_momentum      — Proper 12-1 cross-sectional momentum w/ vol-scaling
 * 3. pead                — Post-Earnings Announcement Drift
 * 4. ict_smc             — ICT Smart Money Concepts (order blocks + FVG)
 * 5. session_breakout    — Asia/London/NY session range breakout
 * 6. cb_divergence       — Central bank policy divergence (forex carry)
 * 7. macro_news_event    — High-impact macro event momentum
 * 8. onchain_signal      — Glassnode on-chain confluence (NUPL + SOPR + reserve)
 * 9. narrative_rotation  — Crypto narrative rotation (sector momentum)
 */

import type { PriceBar } from '@/lib/backtester'
import { BaseStrategy, type StrategySignal } from '../base-strategy'

// ─── Shared price helpers ─────────────────────────────────────────────────────

function sma(bars: PriceBar[], period: number): number {
  const s = bars.slice(-period)
  return s.reduce((a, b) => a + b.close, 0) / s.length
}

function std(bars: PriceBar[], period: number): number {
  const s = bars.slice(-period)
  const m = s.reduce((a, b) => a + b.close, 0) / s.length
  return Math.sqrt(s.reduce((a, b) => a + (b.close - m) ** 2, 0) / s.length)
}

function atr(bars: PriceBar[], period = 14): number {
  const slice = bars.slice(-(period + 1))
  let sum = 0
  for (let i = 1; i < slice.length; i++) {
    const tr = Math.max(
      slice[i].high - slice[i].low,
      Math.abs(slice[i].high - slice[i - 1].close),
      Math.abs(slice[i].low - slice[i - 1].close)
    )
    sum += tr
  }
  return sum / period
}

function rsi(bars: PriceBar[], period = 14): number {
  const closes = bars.slice(-(period + 1)).map(b => b.close)
  let gains = 0, losses = 0
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) gains += d; else losses -= d
  }
  const avgG = gains / period, avgL = losses / period
  return avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL)
}

function mom(bars: PriceBar[], lookback: number): number {
  if (bars.length < lookback + 1) return 0
  return (bars[bars.length - 1].close - bars[bars.length - 1 - lookback].close) /
    bars[bars.length - 1 - lookback].close
}

// ─── 1. vcp_minervini ─────────────────────────────────────────────────────────

/**
 * Volatility Contraction Pattern (Mark Minervini, "Trade Like a Stock Market Wizard").
 *
 * Setup criteria:
 *   1. Price above 150-day SMA and 200-day SMA (trend template)
 *   2. 150-day SMA above 200-day SMA (uptrend structure)
 *   3. Price within 25% of 52-week high (near highs)
 *   4. 52-week low at least 30% below 52-week high (room ran)
 *   5. Volatility contracting over last 3 pivots (VCP) — approximated as
 *      declining 10-day ATR over 3 sequential windows
 *   6. RS Line making new highs (approximated as 20d momentum > 60d momentum)
 *
 * Entry: breakout above the pivot high on volume expansion.
 */
export class VCPMinerviniStrategy extends BaseStrategy {
  readonly id = 'vcp_minervini'
  readonly displayName = 'VCP (Minervini)'
  readonly edgeClassification = 'momentum' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'
  readonly minBars = 200

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < 200) return null

    const last = bars[bars.length - 1]
    const sma150 = sma(bars, 150)
    const sma200 = sma(bars, 200)
    const high52 = Math.max(...bars.slice(-252).map(b => b.high))
    const low52 = Math.min(...bars.slice(-252).map(b => b.low))

    // Trend template (Minervini's 7-point checklist, simplified to 4)
    if (last.close < sma150) return null               // 1. above 150 SMA
    if (last.close < sma200) return null               // 2. above 200 SMA
    if (sma150 < sma200) return null                   // 3. 150 above 200
    if (last.close < high52 * 0.75) return null        // 4. within 25% of 52w high
    if (high52 / low52 < 1.30) return null             // 5. enough range

    // Volatility contraction: ATR declining across 3 windows
    const atr1 = atr(bars.slice(-14), 14)
    const atr2 = atr(bars.slice(-28, -14), 14)
    const atr3 = atr(bars.slice(-42, -28), 14)
    const contracting = atr1 < atr2 && atr2 < atr3

    // RS proxy: recent momentum outpacing longer-term momentum
    const m20 = mom(bars, 20)
    const m60 = mom(bars, 60)
    const rsLeadership = m20 > m60

    if (!contracting || !rsLeadership) return null

    // Pivot breakout: today's high above 10-day pivot high
    const pivot10 = Math.max(...bars.slice(-11, -1).map(b => b.high))
    if (last.close < pivot10 * 1.005) return null  // needs a clean break

    // Volume expansion (optional meta input, assume true if not provided)
    const strength = Math.min(1, (atr2 / atr1 - 1) * 2 + (m20 - m60) * 5 + 0.4)

    return {
      strategyId: this.id, symbol, side: 'buy',
      strength: Math.min(1, strength),
      expectedReturn: 0.08,
      assetClass: this.defaultAssetClass,
      metadata: { sma150, sma200, high52, atr_contraction_ratio: atr2 / atr1, pivot: pivot10 },
    }
  }
}

// ─── 2. quant_momentum ───────────────────────────────────────────────────────

/**
 * 12-1 Cross-Sectional Momentum (AQR / Asness-Moskowitz-Pedersen style).
 *
 * Returns 12-month momentum excluding the most recent month (to avoid reversal).
 * Scaled by realised volatility (vol-targeting to 15% annualised).
 * Signal fires when:
 *   - 12-1 return > 10% (top decile proxy for a single ticker)
 *   - Price above 200-day SMA (trend filter)
 *   - 1-month return not negative (avoid the reversal month)
 */
export class QuantMomentumStrategy extends BaseStrategy {
  readonly id = 'quant_momentum'
  readonly displayName = 'Quant Momentum (12-1)'
  readonly edgeClassification = 'momentum' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'
  readonly minBars = 252

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < 252) return null

    const m12_1 = mom(bars.slice(0, -21), 252 - 21)  // 12m excl last month
    const m1 = mom(bars, 21)                           // last month
    const last = bars[bars.length - 1].close
    const sma200val = sma(bars, 200)

    if (last < sma200val) return null      // trend filter
    if (m12_1 < 0.10) return null          // must be top decile proxy
    if (m1 < 0) return null               // skip reversal month

    // Vol-scaling: target 15% annualised vol
    const realVol = std(bars, 63) / last * Math.sqrt(252)
    const volScale = Math.min(1.5, 0.15 / Math.max(realVol, 0.05))
    const strength = Math.min(1, m12_1 / 0.30 * volScale)

    return {
      strategyId: this.id, symbol, side: 'buy',
      strength,
      expectedReturn: m12_1 * 0.25,  // persistence factor ~ 25%
      assetClass: this.defaultAssetClass,
      metadata: { m12_1, m1, realVol, volScale, sma200: sma200val },
    }
  }
}

// ─── 3. pead ─────────────────────────────────────────────────────────────────

/**
 * Post-Earnings Announcement Drift.
 *
 * Academic evidence: stocks with large positive earnings surprises continue
 * to drift upward for 20–60 days after announcement (Ball & Brown 1968,
 * Bernard & Thomas 1989, countless replications since).
 *
 * Signal requires caller to provide earnings_surprise_pct via metadata.
 * Internal trend filter: price above 50-day SMA (avoid drifting into bear markets).
 */
export class PEADStrategy extends BaseStrategy {
  readonly id = 'pead'
  readonly displayName = 'PEAD (Post-Earnings Drift)'
  readonly edgeClassification = 'momentum' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'
  readonly minBars = 50

  async generateSignal(symbol: string, bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const surprise = meta?.earnings_surprise_pct as number | undefined
    if (surprise === undefined) return null
    if (bars.length < 50) return null

    // Only trade meaningful positive surprises (>= 3%) or large negative (sell)
    if (Math.abs(surprise) < 3) return null

    const last = bars[bars.length - 1].close
    const sma50 = sma(bars, 50)

    if (surprise > 0 && last < sma50) return null  // don't buy into downtrend
    if (surprise < 0 && last > sma50) return null  // don't short into uptrend

    const strength = Math.min(1, Math.abs(surprise) / 15)
    const side: 'buy' | 'sell' = surprise > 0 ? 'buy' : 'sell'

    // Historical drift: ~0.5% per week for 4 weeks post-surprise
    const expectedReturn = side === 'buy' ? 0.02 : -0.015

    return {
      strategyId: this.id, symbol, side, strength,
      expectedReturn,
      assetClass: this.defaultAssetClass,
      metadata: { earnings_surprise_pct: surprise, sma50, drift_window_days: 20 },
    }
  }
}

// ─── 4. ict_smc ──────────────────────────────────────────────────────────────

/**
 * ICT Smart Money Concepts — Order Block + Fair Value Gap.
 *
 * Order Block: the last bearish candle before a strong bullish move up
 *   (institutional accumulation zone). Price returning to that zone is a buy.
 *
 * Fair Value Gap (FVG): three-candle gap where the high of candle N-2 is
 *   below the low of candle N (bullish FVG). Price filling back into the FVG
 *   is an entry point.
 *
 * Uses 15-candle lookback for OB and FVG detection.
 */
export class ICTSMCStrategy extends BaseStrategy {
  readonly id = 'ict_smc'
  readonly displayName = 'ICT Smart Money Concepts'
  readonly edgeClassification = 'reversion' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'
  readonly minBars = 20

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < 20) return null

    const last = bars[bars.length - 1]
    const recent = bars.slice(-15)

    // ── Detect bullish order block ──────────────────────────────────────────
    // Find last bearish candle (close < open) before an impulse up
    let obBottom: number | null = null
    let obTop: number | null = null

    for (let i = recent.length - 4; i >= 1; i--) {
      const candle = recent[i]
      const isBearish = candle.close < candle.open
      const nextIsStrong = recent[i + 1].close > recent[i + 1].open &&
        (recent[i + 1].close - recent[i + 1].open) > (candle.open - candle.close) * 1.5

      if (isBearish && nextIsStrong) {
        obBottom = candle.low
        obTop = candle.open  // body of the bearish OB
        break
      }
    }

    if (obBottom !== null && obTop !== null) {
      // Price returning to OB zone
      if (last.close >= obBottom && last.close <= obTop * 1.01) {
        const atrVal = atr(bars, 14)
        const strength = Math.min(1, (obTop - obBottom) / atrVal)
        return {
          strategyId: this.id, symbol, side: 'buy',
          strength,
          expectedReturn: atrVal / last.close * 2,
          assetClass: this.defaultAssetClass,
          metadata: { pattern: 'order_block', ob_low: obBottom, ob_high: obTop },
        }
      }
    }

    // ── Detect bullish fair value gap ───────────────────────────────────────
    for (let i = recent.length - 3; i >= 1; i--) {
      const prev2High = recent[i - 1]?.high ?? 0
      const currLow = recent[i + 1]?.low ?? Infinity
      if (prev2High < currLow) {
        // FVG exists between prev2High and currLow
        if (last.close >= prev2High && last.close <= currLow) {
          const gapSize = currLow - prev2High
          const strength = Math.min(1, gapSize / (last.close * 0.02))
          return {
            strategyId: this.id, symbol, side: 'buy',
            strength,
            expectedReturn: gapSize / last.close,
            assetClass: this.defaultAssetClass,
            metadata: { pattern: 'fvg', fvg_low: prev2High, fvg_high: currLow },
          }
        }
      }
    }

    return null
  }
}

// ─── 5. session_breakout ─────────────────────────────────────────────────────

/**
 * Session range breakout (Forex / futures).
 *
 * Asia session: 00:00–08:00 UTC  → range usually tight
 * London open:  08:00–10:00 UTC  → first breakout of Asian range often follows
 * NY open:      13:30–15:00 UTC  → second major breakout window
 *
 * Signal: price closes above Asia range high on London/NY bar = buy.
 *         price closes below Asia range low  on London/NY bar = sell.
 *
 * This strategy uses intraday metadata (session_high, session_low) passed via
 * meta, since bars[] here are daily bars from the backtester.
 */
export class SessionBreakoutStrategy extends BaseStrategy {
  readonly id = 'session_breakout'
  readonly displayName = 'Session Range Breakout'
  readonly edgeClassification = 'momentum' as const
  readonly defaultBroker = 'oanda'
  readonly defaultAssetClass = 'forex'
  readonly minBars = 5

  async generateSignal(symbol: string, bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const sessionHigh = meta?.session_high as number | undefined
    const sessionLow = meta?.session_low as number | undefined
    const currentPrice = meta?.current_price as number ?? bars[bars.length - 1]?.close

    if (!sessionHigh || !sessionLow || !currentPrice) return null

    const sessionRange = sessionHigh - sessionLow
    if (sessionRange <= 0) return null

    // Breakout above session high
    if (currentPrice > sessionHigh) {
      const strength = Math.min(1, (currentPrice - sessionHigh) / sessionRange)
      return {
        strategyId: this.id, symbol, side: 'buy',
        strength,
        expectedReturn: sessionRange / currentPrice,
        assetClass: this.defaultAssetClass,
        metadata: { session_high: sessionHigh, session_low: sessionLow, breakout_direction: 'up' },
      }
    }

    // Breakdown below session low
    if (currentPrice < sessionLow) {
      const strength = Math.min(1, (sessionLow - currentPrice) / sessionRange)
      return {
        strategyId: this.id, symbol, side: 'sell',
        strength,
        expectedReturn: sessionRange / currentPrice,
        assetClass: this.defaultAssetClass,
        metadata: { session_high: sessionHigh, session_low: sessionLow, breakout_direction: 'down' },
      }
    }

    return null
  }
}

// ─── 6. cb_divergence ────────────────────────────────────────────────────────

/**
 * Central bank policy divergence.
 *
 * When two central banks are moving in opposite directions
 * (one hiking, one cutting), the currency pair trends strongly.
 *
 * Signal requires caller metadata:
 *   rate_differential: difference in policy rates (hiking - cutting), e.g. 2.5
 *   rate_trend: 'widening' | 'narrowing' | 'stable'
 *
 * Combined with price momentum for timing.
 */
export class CBDivergenceStrategy extends BaseStrategy {
  readonly id = 'cb_divergence'
  readonly displayName = 'Central Bank Divergence'
  readonly edgeClassification = 'macro' as const
  readonly defaultBroker = 'oanda'
  readonly defaultAssetClass = 'forex'
  readonly minBars = 20

  async generateSignal(symbol: string, bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const rateDiff = meta?.rate_differential as number | undefined
    const rateTrend = meta?.rate_trend as string | undefined

    if (rateDiff === undefined || !rateTrend) return null
    if (Math.abs(rateDiff) < 0.5) return null  // min 50bps differential

    const priceMom = bars.length >= 20 ? mom(bars, 20) : 0

    // Only enter when price momentum aligns with rate differential
    const rateAligned = (rateDiff > 0 && priceMom > 0) || (rateDiff < 0 && priceMom < 0)
    if (!rateAligned) return null

    const wideningBonus = rateTrend === 'widening' ? 0.3 : 0
    const strength = Math.min(1, Math.abs(rateDiff) / 3 + wideningBonus)

    return {
      strategyId: this.id, symbol,
      side: rateDiff > 0 ? 'buy' : 'sell',
      strength,
      expectedReturn: Math.min(0.08, Math.abs(rateDiff) * 0.01),
      assetClass: this.defaultAssetClass,
      metadata: { rate_differential: rateDiff, rate_trend: rateTrend, price_momentum: priceMom },
    }
  }
}

// ─── 7. macro_news_event ─────────────────────────────────────────────────────

/**
 * Macro news event momentum.
 *
 * High-impact events (NFP, CPI, FOMC) often trigger strong directional moves.
 * Trade the momentum in the direction of the surprise.
 *
 * Requires metadata:
 *   event_type: 'nfp' | 'cpi' | 'fomc' | 'gdp' | 'pce'
 *   actual: number    (released value)
 *   consensus: number (median forecast)
 *   surprise_pct: number (actual vs consensus deviation in %)
 */
export class MacroNewsEventStrategy extends BaseStrategy {
  readonly id = 'macro_news_event'
  readonly displayName = 'Macro News Event'
  readonly edgeClassification = 'momentum' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'etf'
  readonly minBars = 5

  // Which direction each event surprise is bullish for equities
  private readonly bullishSurprise: Record<string, 'above' | 'below'> = {
    nfp:  'above',   // jobs beat = risk on
    cpi:  'below',   // lower inflation = fed pivot hope
    pce:  'below',
    fomc: 'below',   // lower rates = risk on (simplified)
    gdp:  'above',
  }

  async generateSignal(symbol: string, bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const eventType = meta?.event_type as string | undefined
    const surprisePct = meta?.surprise_pct as number | undefined

    if (!eventType || surprisePct === undefined) return null
    if (Math.abs(surprisePct) < 2) return null  // < 2% surprise not tradeable

    const bullishDir = this.bullishSurprise[eventType]
    if (!bullishDir) return null

    const isBullish =
      (bullishDir === 'above' && surprisePct > 0) ||
      (bullishDir === 'below' && surprisePct < 0)

    const strength = Math.min(1, Math.abs(surprisePct) / 10)

    return {
      strategyId: this.id, symbol,
      side: isBullish ? 'buy' : 'sell',
      strength,
      expectedReturn: isBullish ? 0.015 : -0.015,
      assetClass: this.defaultAssetClass,
      metadata: { event_type: eventType, surprise_pct: surprisePct, direction: isBullish ? 'bullish' : 'bearish' },
    }
  }
}

// ─── 8. onchain_signal ───────────────────────────────────────────────────────

/**
 * On-chain signal using Glassnode metrics.
 *
 * Composite signal from:
 *   NUPL (Net Unrealised Profit/Loss): < 0 = fear/buy, > 0.75 = greed/sell
 *   SOPR (Spent Output Profit Ratio): < 1 = panic sell (buy), > 1.2 = profit-taking (sell)
 *   Exchange net position change: negative = coins leaving exchanges (bullish)
 *   Miner reserve: declining = miner selling (bearish)
 *
 * Requires Glassnode feature flag to be enabled (costs per API call).
 */
export class OnChainSignalStrategy extends BaseStrategy {
  readonly id = 'onchain_signal'
  readonly displayName = 'On-Chain Signal (Glassnode)'
  readonly edgeClassification = 'sentiment' as const
  readonly defaultBroker = 'kraken'
  readonly defaultAssetClass = 'crypto'
  readonly minBars = 0

  async generateSignal(symbol: string, _bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const nupl = meta?.nupl as number | undefined
    const sopr = meta?.sopr as number | undefined
    const exchangeFlow = meta?.exchange_net_flow as number | undefined  // negative = outflow
    const minerReserve = meta?.miner_reserve_change as number | undefined  // negative = selling

    if (nupl === undefined || sopr === undefined) return null

    let score = 0  // positive = bullish, negative = bearish
    const signals: string[] = []

    // NUPL
    if (nupl < 0) { score += 2; signals.push(`NUPL=${nupl.toFixed(2)} (fear)`) }
    else if (nupl > 0.75) { score -= 2; signals.push(`NUPL=${nupl.toFixed(2)} (greed)`) }

    // SOPR
    if (sopr < 0.98) { score += 1.5; signals.push(`SOPR=${sopr.toFixed(3)} (panic)`) }
    else if (sopr > 1.20) { score -= 1.5; signals.push(`SOPR=${sopr.toFixed(3)} (distribution)`) }

    // Exchange flow
    if (exchangeFlow !== undefined) {
      if (exchangeFlow < -1000) { score += 1; signals.push(`exchange_outflow=${exchangeFlow.toFixed(0)} BTC`) }
      if (exchangeFlow > 1000) { score -= 1; signals.push(`exchange_inflow=${exchangeFlow.toFixed(0)} BTC`) }
    }

    // Miner reserve
    if (minerReserve !== undefined) {
      if (minerReserve < 0) { score -= 0.5; signals.push(`miner_selling`) }
    }

    if (Math.abs(score) < 1.5) return null

    const side: 'buy' | 'sell' = score > 0 ? 'buy' : 'sell'
    const strength = Math.min(1, Math.abs(score) / 4)

    return {
      strategyId: this.id, symbol, side, strength,
      expectedReturn: side === 'buy' ? 0.10 : -0.06,
      assetClass: this.defaultAssetClass,
      metadata: { score, signals, nupl, sopr, exchangeFlow, minerReserve },
    }
  }
}

// ─── 9. narrative_rotation ────────────────────────────────────────────────────

/**
 * Crypto narrative rotation.
 *
 * Crypto markets rotate through narratives every 3–8 weeks:
 *   L1s → DeFi → AI coins → GameFi → Memes → RWA → back to BTC/ETH
 *
 * This strategy detects which narrative is gaining momentum and buys
 * the basket leader. Signal uses 7-day relative momentum across sectors.
 *
 * Requires metadata:
 *   sector_momentum: Record<string, number>  — 7d return per sector
 *   current_sector: string  — sector of the symbol being evaluated
 */
export class NarrativeRotationStrategy extends BaseStrategy {
  readonly id = 'narrative_rotation'
  readonly displayName = 'Crypto Narrative Rotation'
  readonly edgeClassification = 'momentum' as const
  readonly defaultBroker = 'kraken'
  readonly defaultAssetClass = 'crypto'
  readonly minBars = 7

  async generateSignal(symbol: string, bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const sectorMomentum = meta?.sector_momentum as Record<string, number> | undefined
    const currentSector = meta?.current_sector as string | undefined

    if (!sectorMomentum || !currentSector) {
      // Fallback: use raw 7d price momentum if sector data not available
      if (bars.length < 7) return null
      const m7 = mom(bars, 7)
      const m30 = mom(bars, Math.min(30, bars.length - 1))
      if (m7 > 0.10 && m7 > m30 * 2) {
        return {
          strategyId: this.id, symbol, side: 'buy',
          strength: Math.min(1, m7 / 0.25),
          expectedReturn: m7 * 0.30,
          assetClass: this.defaultAssetClass,
          metadata: { method: 'price_momentum_fallback', m7, m30 },
        }
      }
      return null
    }

    const sectorReturn = sectorMomentum[currentSector] ?? 0
    const allReturns = Object.values(sectorMomentum)
    const maxReturn = Math.max(...allReturns)
    const minReturn = Math.min(...allReturns)

    // Buy if this sector is the top performer with significant momentum
    if (sectorReturn === maxReturn && sectorReturn > 0.07) {
      const relativeStrength = (sectorReturn - minReturn) / (maxReturn - minReturn + 0.001)
      return {
        strategyId: this.id, symbol, side: 'buy',
        strength: Math.min(1, relativeStrength),
        expectedReturn: sectorReturn * 0.30,
        assetClass: this.defaultAssetClass,
        metadata: { sector: currentSector, sector_7d: sectorReturn, rank: 1, sector_momentum: sectorMomentum },
      }
    }

    // Sell if this sector is the bottom performer with strong negative momentum
    if (sectorReturn === minReturn && sectorReturn < -0.07) {
      const relativeWeakness = (maxReturn - sectorReturn) / (maxReturn - minReturn + 0.001)
      return {
        strategyId: this.id, symbol, side: 'sell',
        strength: Math.min(1, relativeWeakness * 0.7),
        expectedReturn: sectorReturn * 0.20,
        assetClass: this.defaultAssetClass,
        metadata: { sector: currentSector, sector_7d: sectorReturn, rank: 'last', sector_momentum: sectorMomentum },
      }
    }

    return null
  }
}

export const TIER2_STRATEGIES = [
  new VCPMinerviniStrategy(),
  new QuantMomentumStrategy(),
  new PEADStrategy(),
  new ICTSMCStrategy(),
  new SessionBreakoutStrategy(),
  new CBDivergenceStrategy(),
  new MacroNewsEventStrategy(),
  new OnChainSignalStrategy(),
  new NarrativeRotationStrategy(),
]
