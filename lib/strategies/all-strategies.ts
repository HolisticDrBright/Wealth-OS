/**
 * All 39 strategy implementations.
 * Each is a minimal but correct subclass of BaseStrategy.
 * Signal generation uses price-bar math — no external calls.
 */

import type { PriceBar } from '@/lib/backtester'
import { BaseStrategy, type StrategySignal } from './base-strategy'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sma(bars: PriceBar[], period: number): number {
  const slice = bars.slice(-period)
  return slice.reduce((s, b) => s + b.close, 0) / slice.length
}

function stddev(bars: PriceBar[], period: number): number {
  const slice = bars.slice(-period)
  const mean = slice.reduce((s, b) => s + b.close, 0) / slice.length
  const variance = slice.reduce((s, b) => s + (b.close - mean) ** 2, 0) / slice.length
  return Math.sqrt(variance)
}

function rsi(bars: PriceBar[], period = 14): number {
  const closes = bars.slice(-(period + 1)).map(b => b.close)
  let gains = 0, losses = 0
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff
    else losses -= diff
  }
  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  return 100 - 100 / (1 + avgGain / avgLoss)
}

function momentum(bars: PriceBar[], lookback: number): number {
  if (bars.length < lookback + 1) return 0
  return (bars[bars.length - 1].close - bars[bars.length - 1 - lookback].close) / bars[bars.length - 1 - lookback].close
}

function sig(symbol: string, side: 'buy' | 'sell', strength: number, expectedReturn: number, strategyId: string, assetClass: string, meta?: Record<string, unknown>): StrategySignal {
  return { strategyId, symbol, side, strength, expectedReturn, assetClass, metadata: meta }
}

// ─── 1. Momentum ──────────────────────────────────────────────────────────────

export class MomentumStrategy extends BaseStrategy {
  readonly id = 'momentum'
  readonly displayName = 'Price Momentum'
  readonly edgeClassification = 'momentum' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < this.minBars) return null
    const m = momentum(bars, 20)
    if (Math.abs(m) < 0.03) return null
    return sig(symbol, m > 0 ? 'buy' : 'sell', Math.min(1, Math.abs(m) / 0.1), m, this.id, this.defaultAssetClass)
  }
}

// ─── 2. Breakout ──────────────────────────────────────────────────────────────

export class BreakoutStrategy extends BaseStrategy {
  readonly id = 'breakout'
  readonly displayName = '52-Week Breakout'
  readonly edgeClassification = 'momentum' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < 52) return null
    const high52 = Math.max(...bars.slice(-252).map(b => b.high))
    const last = bars[bars.length - 1].close
    if (last < high52 * 0.99) return null
    return sig(symbol, 'buy', 0.8, 0.04, this.id, this.defaultAssetClass)
  }
}

// ─── 3. Trend Following ───────────────────────────────────────────────────────

export class TrendFollowingStrategy extends BaseStrategy {
  readonly id = 'trend_following'
  readonly displayName = 'EMA Trend Following'
  readonly edgeClassification = 'momentum' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < 50) return null
    const ema20 = sma(bars, 20)
    const ema50 = sma(bars, 50)
    if (Math.abs(ema20 - ema50) / ema50 < 0.01) return null
    const side = ema20 > ema50 ? 'buy' : 'sell'
    return sig(symbol, side, 0.7, (ema20 - ema50) / ema50, this.id, this.defaultAssetClass)
  }
}

// ─── 4. Dual Momentum ────────────────────────────────────────────────────────

export class DualMomentumStrategy extends BaseStrategy {
  readonly id = 'dual_momentum'
  readonly displayName = 'Dual Momentum (Antonacci)'
  readonly edgeClassification = 'momentum' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < 252) return null
    const abs = momentum(bars, 252)  // absolute momentum
    const rel = momentum(bars, 120)  // relative momentum proxy
    if (abs < 0) return sig(symbol, 'sell', 0.6, abs, this.id, this.defaultAssetClass)
    if (rel > 0.05) return sig(symbol, 'buy', 0.75, rel, this.id, this.defaultAssetClass)
    return null
  }
}

// ─── 5. Cross-Sectional Momentum ─────────────────────────────────────────────

export class CrossSectionalMomentumStrategy extends BaseStrategy {
  readonly id = 'cross_sectional_momentum'
  readonly displayName = 'Cross-Sectional Momentum'
  readonly edgeClassification = 'momentum' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < 126) return null
    const m = momentum(bars, 126)
    if (m > 0.05) return sig(symbol, 'buy', m / 0.2, m, this.id, this.defaultAssetClass)
    if (m < -0.05) return sig(symbol, 'sell', Math.abs(m) / 0.2, m, this.id, this.defaultAssetClass)
    return null
  }
}

// ─── 6. Mean Reversion ────────────────────────────────────────────────────────

export class MeanReversionStrategy extends BaseStrategy {
  readonly id = 'mean_reversion'
  readonly displayName = 'Mean Reversion'
  readonly edgeClassification = 'reversion' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < 20) return null
    const mean = sma(bars, 20)
    const sd = stddev(bars, 20)
    const last = bars[bars.length - 1].close
    const z = (last - mean) / sd
    if (Math.abs(z) < 1.5) return null
    return sig(symbol, z < 0 ? 'buy' : 'sell', Math.min(1, Math.abs(z) / 3), -z * sd / mean, this.id, this.defaultAssetClass)
  }
}

// ─── 7. Statistical Arbitrage ─────────────────────────────────────────────────

export class StatArbStrategy extends BaseStrategy {
  readonly id = 'stat_arb'
  readonly displayName = 'Statistical Arbitrage'
  readonly edgeClassification = 'arb' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < 30) return null
    const z = (bars[bars.length - 1].close - sma(bars, 30)) / stddev(bars, 30)
    if (Math.abs(z) < 2) return null
    return sig(symbol, z < 0 ? 'buy' : 'sell', 0.7, -z * 0.01, this.id, this.defaultAssetClass)
  }
}

// ─── 8. Pairs Trading ────────────────────────────────────────────────────────

export class PairsTradingStrategy extends BaseStrategy {
  readonly id = 'pairs_trading'
  readonly displayName = 'Pairs Trading'
  readonly edgeClassification = 'arb' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < 20) return null
    const m = momentum(bars, 5)
    if (Math.abs(m) < 0.02) return null
    return sig(symbol, m < 0 ? 'buy' : 'sell', 0.5, -m, this.id, this.defaultAssetClass)
  }
}

// ─── 9. Bollinger Reversion ───────────────────────────────────────────────────

export class BollingerReversionStrategy extends BaseStrategy {
  readonly id = 'bollinger_reversion'
  readonly displayName = 'Bollinger Band Reversion'
  readonly edgeClassification = 'reversion' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < 20) return null
    const mid = sma(bars, 20)
    const sd = stddev(bars, 20)
    const last = bars[bars.length - 1].close
    const upper = mid + 2 * sd
    const lower = mid - 2 * sd
    if (last > upper) return sig(symbol, 'sell', 0.75, (mid - last) / last, this.id, this.defaultAssetClass)
    if (last < lower) return sig(symbol, 'buy', 0.75, (mid - last) / last, this.id, this.defaultAssetClass)
    return null
  }
}

// ─── 10. RSI Reversion ───────────────────────────────────────────────────────

export class RSIReversionStrategy extends BaseStrategy {
  readonly id = 'rsi_reversion'
  readonly displayName = 'RSI Reversion'
  readonly edgeClassification = 'reversion' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < 16) return null
    const r = rsi(bars)
    if (r < 30) return sig(symbol, 'buy', (30 - r) / 30, 0.02, this.id, this.defaultAssetClass)
    if (r > 70) return sig(symbol, 'sell', (r - 70) / 30, -0.02, this.id, this.defaultAssetClass)
    return null
  }
}

// ─── 11. Value ───────────────────────────────────────────────────────────────

export class ValueStrategy extends BaseStrategy {
  readonly id = 'value'
  readonly displayName = 'Deep Value'
  readonly edgeClassification = 'factor' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const pe = meta?.pe_ratio as number | undefined
    if (!pe) return null
    if (pe < 12) return sig(symbol, 'buy', Math.min(1, (15 - pe) / 15), 0.08, this.id, this.defaultAssetClass)
    return null
  }
}

// ─── 12. Quality ─────────────────────────────────────────────────────────────

export class QualityStrategy extends BaseStrategy {
  readonly id = 'quality'
  readonly displayName = 'Quality Factor'
  readonly edgeClassification = 'factor' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const roe = meta?.roe as number | undefined
    if (!roe || roe < 0.15) return null
    return sig(symbol, 'buy', Math.min(1, roe / 0.3), 0.05, this.id, this.defaultAssetClass)
  }
}

// ─── 13. Low Volatility ───────────────────────────────────────────────────────

export class LowVolatilityStrategy extends BaseStrategy {
  readonly id = 'low_volatility'
  readonly displayName = 'Low Volatility'
  readonly edgeClassification = 'factor' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < 20) return null
    const vol = stddev(bars, 20) / sma(bars, 20)
    if (vol > 0.02) return null
    return sig(symbol, 'buy', 0.5, 0.03, this.id, this.defaultAssetClass)
  }
}

// ─── 14. Size ─────────────────────────────────────────────────────────────────

export class SizeStrategy extends BaseStrategy {
  readonly id = 'size'
  readonly displayName = 'Small-Cap Size'
  readonly edgeClassification = 'factor' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const mktCap = meta?.market_cap as number | undefined
    if (!mktCap || mktCap > 2e9) return null
    return sig(symbol, 'buy', 0.6, 0.04, this.id, this.defaultAssetClass)
  }
}

// ─── 15. Profitability ────────────────────────────────────────────────────────

export class ProfitabilityStrategy extends BaseStrategy {
  readonly id = 'profitability'
  readonly displayName = 'Profitability Factor'
  readonly edgeClassification = 'factor' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const gp = meta?.gross_profit_margin as number | undefined
    if (!gp || gp < 0.4) return null
    return sig(symbol, 'buy', Math.min(1, gp), 0.05, this.id, this.defaultAssetClass)
  }
}

// ─── 16. Macro Regime ────────────────────────────────────────────────────────

export class MacroRegimeStrategy extends BaseStrategy {
  readonly id = 'macro_regime'
  readonly displayName = 'Macro Regime'
  readonly edgeClassification = 'macro' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'etf'

  async generateSignal(symbol: string, bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    if (bars.length < 50) return null
    const regime = meta?.regime as string | undefined
    const m = momentum(bars, 50)
    if (regime === 'expansion' || m > 0.05) return sig(symbol, 'buy', 0.7, m, this.id, this.defaultAssetClass)
    if (regime === 'contraction' || m < -0.05) return sig(symbol, 'sell', 0.7, m, this.id, this.defaultAssetClass)
    return null
  }
}

// ─── 17. Risk Parity ─────────────────────────────────────────────────────────

export class RiskParityStrategy extends BaseStrategy {
  readonly id = 'risk_parity'
  readonly displayName = 'Risk Parity'
  readonly edgeClassification = 'systematic' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'etf'

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < 20) return null
    const vol = stddev(bars, 20)
    if (vol === 0) return null
    const targetRisk = 0.10 / Math.sqrt(252)
    const weight = targetRisk / vol
    return sig(symbol, 'buy', Math.min(1, weight), 0.03, this.id, this.defaultAssetClass)
  }
}

// ─── 18. Global Macro ────────────────────────────────────────────────────────

export class GlobalMacroStrategy extends BaseStrategy {
  readonly id = 'global_macro'
  readonly displayName = 'Global Macro'
  readonly edgeClassification = 'macro' as const
  readonly defaultBroker = 'oanda'
  readonly defaultAssetClass = 'forex'

  async generateSignal(symbol: string, bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    if (bars.length < 60) return null
    const m = momentum(bars, 60)
    const rate_diff = meta?.interest_rate_diff as number | undefined
    if (!rate_diff && Math.abs(m) < 0.03) return null
    const combined = m + (rate_diff ?? 0) * 0.5
    return sig(symbol, combined > 0 ? 'buy' : 'sell', Math.min(1, Math.abs(combined) / 0.1), combined, this.id, this.defaultAssetClass)
  }
}

// ─── 19. Carry Trade ─────────────────────────────────────────────────────────

export class CarryTradeStrategy extends BaseStrategy {
  readonly id = 'carry_trade'
  readonly displayName = 'FX Carry'
  readonly edgeClassification = 'factor' as const
  readonly defaultBroker = 'oanda'
  readonly defaultAssetClass = 'forex'

  async generateSignal(symbol: string, bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const carry = meta?.carry_yield as number | undefined
    if (!carry || Math.abs(carry) < 0.01) return null
    return sig(symbol, carry > 0 ? 'buy' : 'sell', Math.min(1, Math.abs(carry) / 0.05), carry, this.id, this.defaultAssetClass)
  }
}

// ─── 20. Volatility Regime ───────────────────────────────────────────────────

export class VolatilityRegimeStrategy extends BaseStrategy {
  readonly id = 'volatility_regime'
  readonly displayName = 'Volatility Regime'
  readonly edgeClassification = 'macro' as const
  readonly defaultBroker = 'tastytrade'
  readonly defaultAssetClass = 'options'

  async generateSignal(symbol: string, bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    if (bars.length < 20) return null
    const vol = stddev(bars, 20) / sma(bars, 20) * Math.sqrt(252)
    const vix = meta?.vix as number | undefined
    const impliedVol = vix ? vix / 100 : vol
    if (impliedVol > vol * 1.2) return sig(symbol, 'sell', 0.7, -0.02, this.id, this.defaultAssetClass)
    if (vol > impliedVol * 1.2) return sig(symbol, 'buy', 0.6, 0.02, this.id, this.defaultAssetClass)
    return null
  }
}

// ─── 21. Crypto Momentum ─────────────────────────────────────────────────────

export class CryptoMomentumStrategy extends BaseStrategy {
  readonly id = 'crypto_momentum'
  readonly displayName = 'Crypto Momentum'
  readonly edgeClassification = 'momentum' as const
  readonly defaultBroker = 'kraken'
  readonly defaultAssetClass = 'crypto'

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < 14) return null
    const m = momentum(bars, 14)
    if (Math.abs(m) < 0.05) return null
    return sig(symbol, m > 0 ? 'buy' : 'sell', Math.min(1, Math.abs(m) / 0.15), m, this.id, this.defaultAssetClass)
  }
}

// ─── 22. Crypto Mean Reversion ───────────────────────────────────────────────

export class CryptoMeanReversionStrategy extends BaseStrategy {
  readonly id = 'crypto_mean_reversion'
  readonly displayName = 'Crypto Mean Reversion'
  readonly edgeClassification = 'reversion' as const
  readonly defaultBroker = 'kraken'
  readonly defaultAssetClass = 'crypto'

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < 20) return null
    const z = (bars[bars.length - 1].close - sma(bars, 20)) / stddev(bars, 20)
    if (Math.abs(z) < 2) return null
    return sig(symbol, z < 0 ? 'buy' : 'sell', Math.min(1, Math.abs(z) / 4), -z * 0.02, this.id, this.defaultAssetClass)
  }
}

// ─── 23. DeFi Yield ──────────────────────────────────────────────────────────

export class DeFiYieldStrategy extends BaseStrategy {
  readonly id = 'defi_yield'
  readonly displayName = 'DeFi Yield Farming'
  readonly edgeClassification = 'arb' as const
  readonly defaultBroker = 'kraken'
  readonly defaultAssetClass = 'crypto'

  async generateSignal(symbol: string, _bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const apy = meta?.pool_apy as number | undefined
    if (!apy || apy < 0.05) return null
    return sig(symbol, 'buy', Math.min(1, apy / 0.2), apy / 12, this.id, this.defaultAssetClass)
  }
}

// ─── 24. On-Chain Signal ─────────────────────────────────────────────────────

export class OnChainSignalStrategy extends BaseStrategy {
  readonly id = 'on_chain_signal'
  readonly displayName = 'On-Chain Signal'
  readonly edgeClassification = 'sentiment' as const
  readonly defaultBroker = 'kraken'
  readonly defaultAssetClass = 'crypto'

  async generateSignal(symbol: string, _bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const nupl = meta?.nupl as number | undefined
    const sopr = meta?.sopr as number | undefined
    if (nupl === undefined || sopr === undefined) return null
    if (nupl < 0 && sopr < 1) return sig(symbol, 'buy', 0.8, 0.1, this.id, this.defaultAssetClass)
    if (nupl > 0.6 && sopr > 1.2) return sig(symbol, 'sell', 0.8, -0.05, this.id, this.defaultAssetClass)
    return null
  }
}

// ─── 25. Funding Rate Arb ────────────────────────────────────────────────────

export class FundingRateArbStrategy extends BaseStrategy {
  readonly id = 'funding_rate_arb'
  readonly displayName = 'Funding Rate Arbitrage'
  readonly edgeClassification = 'arb' as const
  readonly defaultBroker = 'deribit'
  readonly defaultAssetClass = 'crypto_futures'

  async generateSignal(symbol: string, _bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const fundingRate = meta?.funding_rate as number | undefined
    if (fundingRate === undefined || Math.abs(fundingRate) < 0.001) return null
    // Positive funding: short perp COLLECTS funding; negative: long perp collects.
    // Either way the correct side EARNS |funding| — expectedReturn is +|rate|.
    // (The old `-fundingRate` made every positive-funding signal look like a loss.)
    return sig(symbol, fundingRate > 0 ? 'sell' : 'buy', Math.min(1, Math.abs(fundingRate) / 0.01), Math.abs(fundingRate), this.id, this.defaultAssetClass)
  }
}

// ─── 26. Options Flow ────────────────────────────────────────────────────────

export class OptionsFlowStrategy extends BaseStrategy {
  readonly id = 'options_flow'
  readonly displayName = 'Options Dark Pool Flow'
  readonly edgeClassification = 'sentiment' as const
  readonly defaultBroker = 'tastytrade'
  readonly defaultAssetClass = 'options'

  async generateSignal(symbol: string, _bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const pcRatio = meta?.put_call_ratio as number | undefined
    if (!pcRatio) return null
    if (pcRatio < 0.5) return sig(symbol, 'buy', (1 - pcRatio) / 0.5, 0.03, this.id, this.defaultAssetClass)
    if (pcRatio > 1.5) return sig(symbol, 'sell', (pcRatio - 1) / 0.5, -0.03, this.id, this.defaultAssetClass)
    return null
  }
}

// ─── 27. Volatility Selling ───────────────────────────────────────────────────

export class VolatilitySelling extends BaseStrategy {
  readonly id = 'volatility_selling'
  readonly displayName = 'Volatility Selling'
  readonly edgeClassification = 'systematic' as const
  readonly defaultBroker = 'tastytrade'
  readonly defaultAssetClass = 'options'

  async generateSignal(symbol: string, bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    if (bars.length < 20) return null
    const hvol = stddev(bars, 20) / sma(bars, 20) * Math.sqrt(252)
    const ivol = (meta?.iv_rank as number | undefined ?? 0) / 100
    if (ivol > 0.6 && ivol > hvol) return sig(symbol, 'sell', ivol, 0.02, this.id, this.defaultAssetClass)
    return null
  }
}

// ─── 28. Gamma Scalping ───────────────────────────────────────────────────────

export class GammaScalpingStrategy extends BaseStrategy {
  readonly id = 'gamma_scalping'
  readonly displayName = 'Gamma Scalping'
  readonly edgeClassification = 'systematic' as const
  readonly defaultBroker = 'tastytrade'
  readonly defaultAssetClass = 'options'

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < 5) return null
    const m = momentum(bars, 3)
    return sig(symbol, m > 0 ? 'buy' : 'sell', 0.5, Math.abs(m) * 0.5, this.id, this.defaultAssetClass)
  }
}

// ─── 29. Covered Calls ───────────────────────────────────────────────────────

export class CoveredCallsStrategy extends BaseStrategy {
  readonly id = 'covered_calls'
  readonly displayName = 'Covered Call Writing'
  readonly edgeClassification = 'systematic' as const
  readonly defaultBroker = 'tastytrade'
  readonly defaultAssetClass = 'options'

  async generateSignal(symbol: string, _bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const ivRank = meta?.iv_rank as number | undefined
    if (!ivRank || ivRank < 50) return null
    return sig(symbol, 'sell', ivRank / 100, 0.01, this.id, this.defaultAssetClass)
  }
}

// ─── 30. Protective Puts ─────────────────────────────────────────────────────

export class ProtectivePutsStrategy extends BaseStrategy {
  readonly id = 'protective_puts'
  readonly displayName = 'Protective Puts'
  readonly edgeClassification = 'systematic' as const
  readonly defaultBroker = 'tastytrade'
  readonly defaultAssetClass = 'options'

  async generateSignal(symbol: string, bars: PriceBar[]): Promise<StrategySignal | null> {
    if (bars.length < 20) return null
    const m = momentum(bars, 20)
    if (m < -0.05) return sig(symbol, 'buy', Math.min(1, Math.abs(m) / 0.1), 0.01, this.id, this.defaultAssetClass)
    return null
  }
}

// ─── 31. News Sentiment ───────────────────────────────────────────────────────

export class NewsSentimentStrategy extends BaseStrategy {
  readonly id = 'news_sentiment'
  readonly displayName = 'News Sentiment'
  readonly edgeClassification = 'sentiment' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, _bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const score = meta?.sentiment_score as number | undefined
    if (score === undefined || Math.abs(score) < 0.3) return null
    return sig(symbol, score > 0 ? 'buy' : 'sell', Math.min(1, Math.abs(score)), score * 0.02, this.id, this.defaultAssetClass)
  }
}

// ─── 32. Earnings Momentum ───────────────────────────────────────────────────

export class EarningsMomentumStrategy extends BaseStrategy {
  readonly id = 'earnings_momentum'
  readonly displayName = 'Earnings Momentum (PEAD)'
  readonly edgeClassification = 'momentum' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, _bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const surprise = meta?.earnings_surprise_pct as number | undefined
    if (surprise === undefined || Math.abs(surprise) < 2) return null
    return sig(symbol, surprise > 0 ? 'buy' : 'sell', Math.min(1, Math.abs(surprise) / 10), surprise * 0.005, this.id, this.defaultAssetClass)
  }
}

// ─── 33. Insider Flow ────────────────────────────────────────────────────────

export class InsiderFlowStrategy extends BaseStrategy {
  readonly id = 'insider_flow'
  readonly displayName = 'Insider Trading Flow'
  readonly edgeClassification = 'sentiment' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, _bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const netInsider = meta?.net_insider_buys as number | undefined
    if (!netInsider || Math.abs(netInsider) < 100000) return null
    return sig(symbol, netInsider > 0 ? 'buy' : 'sell', Math.min(1, Math.abs(netInsider) / 1e6), netInsider > 0 ? 0.03 : -0.02, this.id, this.defaultAssetClass)
  }
}

// ─── 34. Congressional Flow ───────────────────────────────────────────────────

export class CongressionalFlowStrategy extends BaseStrategy {
  readonly id = 'congressional_flow'
  readonly displayName = 'Congressional Trade Flow'
  readonly edgeClassification = 'sentiment' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, _bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const txType = meta?.congress_tx_type as string | undefined
    if (!txType) return null
    return sig(symbol, txType === 'purchase' ? 'buy' : 'sell', 0.65, txType === 'purchase' ? 0.02 : -0.02, this.id, this.defaultAssetClass)
  }
}

// ─── 35. Social Sentiment ────────────────────────────────────────────────────

export class SocialSentimentStrategy extends BaseStrategy {
  readonly id = 'social_sentiment'
  readonly displayName = 'Social Media Sentiment'
  readonly edgeClassification = 'sentiment' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, _bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const score = meta?.social_score as number | undefined
    if (score === undefined || Math.abs(score) < 0.5) return null
    return sig(symbol, score > 0 ? 'buy' : 'sell', Math.min(1, Math.abs(score)), score * 0.01, this.id, this.defaultAssetClass)
  }
}

// ─── 36. Polymarket Arbitrage ────────────────────────────────────────────────

export class PolymarketArbitrageStrategy extends BaseStrategy {
  readonly id = 'polymarket_arbitrage'
  readonly displayName = 'Polymarket Arbitrage'
  readonly edgeClassification = 'arb' as const
  readonly defaultBroker = 'polymarket'
  readonly defaultAssetClass = 'prediction_market'

  async generateSignal(symbol: string, _bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const marketProb = meta?.market_probability as number | undefined
    const modelProb = meta?.model_probability as number | undefined
    if (marketProb === undefined || modelProb === undefined) return null
    const edge = modelProb - marketProb
    if (Math.abs(edge) < 0.05) return null
    return sig(symbol, edge > 0 ? 'buy' : 'sell', Math.min(1, Math.abs(edge) / 0.2), edge, this.id, this.defaultAssetClass)
  }
}

// ─── 37. Copy Trade ──────────────────────────────────────────────────────────

export class CopyTradeStrategy extends BaseStrategy {
  readonly id = 'copy_trade'
  readonly displayName = 'Copy Trade'
  readonly edgeClassification = 'momentum' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, _bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const traderAction = meta?.trader_action as string | undefined
    const traderScore = meta?.trader_score as number | undefined
    if (!traderAction || !traderScore) return null
    return sig(symbol, traderAction as 'buy' | 'sell', Math.min(1, traderScore / 100), traderAction === 'buy' ? 0.02 : -0.02, this.id, this.defaultAssetClass, meta)
  }
}

// ─── 38. Tax Loss Harvest ────────────────────────────────────────────────────

export class TaxLossHarvestStrategy extends BaseStrategy {
  readonly id = 'tax_loss_harvest'
  readonly displayName = 'Tax-Loss Harvesting'
  readonly edgeClassification = 'systematic' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, _bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const unrealizedLoss = meta?.unrealized_loss_pct as number | undefined
    if (!unrealizedLoss || unrealizedLoss > -0.05) return null
    return sig(symbol, 'sell', Math.min(1, Math.abs(unrealizedLoss) / 0.3), 0, this.id, this.defaultAssetClass)
  }
}

// ─── 39. Rebalance ───────────────────────────────────────────────────────────

export class RebalanceStrategy extends BaseStrategy {
  readonly id = 'rebalance'
  readonly displayName = 'Portfolio Rebalance'
  readonly edgeClassification = 'systematic' as const
  readonly defaultBroker = 'alpaca'
  readonly defaultAssetClass = 'stock'

  async generateSignal(symbol: string, _bars: PriceBar[], meta?: Record<string, unknown>): Promise<StrategySignal | null> {
    const drift = meta?.allocation_drift_pct as number | undefined
    if (!drift || Math.abs(drift) < 0.05) return null
    return sig(symbol, drift > 0 ? 'sell' : 'buy', Math.min(1, Math.abs(drift) / 0.2), 0, this.id, this.defaultAssetClass)
  }
}

// ─── Tier 1 + Tier 2 re-exports ───────────────────────────────────────────────
export { TIER1_STRATEGIES } from './tier1'
export { TIER2_STRATEGIES } from './tier2'

// ─── Registry ─────────────────────────────────────────────────────────────────

import { TIER1_STRATEGIES } from './tier1'
import { TIER2_STRATEGIES } from './tier2'

export const ALL_STRATEGIES: BaseStrategy[] = [
  new MomentumStrategy(),
  new BreakoutStrategy(),
  new TrendFollowingStrategy(),
  new DualMomentumStrategy(),
  new CrossSectionalMomentumStrategy(),
  new MeanReversionStrategy(),
  new StatArbStrategy(),
  new PairsTradingStrategy(),
  new BollingerReversionStrategy(),
  new RSIReversionStrategy(),
  new ValueStrategy(),
  new QualityStrategy(),
  new LowVolatilityStrategy(),
  new SizeStrategy(),
  new ProfitabilityStrategy(),
  new MacroRegimeStrategy(),
  new RiskParityStrategy(),
  new GlobalMacroStrategy(),
  new CarryTradeStrategy(),
  new VolatilityRegimeStrategy(),
  new CryptoMomentumStrategy(),
  new CryptoMeanReversionStrategy(),
  new DeFiYieldStrategy(),
  new OnChainSignalStrategy(),
  new FundingRateArbStrategy(),
  new OptionsFlowStrategy(),
  new VolatilitySelling(),
  new GammaScalpingStrategy(),
  new CoveredCallsStrategy(),
  new ProtectivePutsStrategy(),
  new NewsSentimentStrategy(),
  new EarningsMomentumStrategy(),
  new InsiderFlowStrategy(),
  new CongressionalFlowStrategy(),
  new SocialSentimentStrategy(),
  new PolymarketArbitrageStrategy(),
  new CopyTradeStrategy(),
  new TaxLossHarvestStrategy(),
  new RebalanceStrategy(),
  ...TIER1_STRATEGIES,
  ...TIER2_STRATEGIES,
]

export const STRATEGY_REGISTRY = new Map(ALL_STRATEGIES.map(s => [s.id, s]))
