/**
 * Basic options support.
 * Black-Scholes pricing + Greeks for display purposes.
 * Position P&L tracking for calls and puts.
 *
 * For live options chains, wire in Tradier's free options API
 * (TRADIER_API_KEY) or Alpaca's options endpoints.
 */

export type OptionType = 'call' | 'put'
export type OptionStrategy = 'long_call' | 'short_call' | 'long_put' | 'short_put'
  | 'covered_call' | 'protective_put' | 'cash_secured_put' | 'straddle' | 'strangle'

export interface OptionPosition {
  id: string
  user_id: string
  symbol: string            // underlying
  option_type: OptionType
  strategy: OptionStrategy
  strike: number
  expiration: string        // YYYY-MM-DD
  contracts: number         // number of contracts (1 contract = 100 shares)
  premium_paid: number      // per-share premium paid (or received if short)
  current_price?: number    // current option mid-price
  underlying_price?: number // current underlying price
  opened_at: string
  closed_at?: string
  is_short: boolean
}

export interface Greeks {
  delta: number
  gamma: number
  theta: number    // per day
  vega: number     // per 1% vol change
  rho: number
  iv: number       // implied volatility
}

export interface OptionPnL {
  unrealizedPnL: number
  unrealizedPnLPct: number
  maxProfit: number
  maxLoss: number
  breakeven: number | number[]
  daysToExpiry: number
}

// ─── Black-Scholes ────────────────────────────────────────

/** Cumulative standard normal distribution (Abramowitz & Stegun approximation) */
function normCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const sign = x < 0 ? -1 : 1
  x = Math.abs(x) / Math.sqrt(2)
  const t = 1 / (1 + p * x)
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

/**
 * Black-Scholes option price.
 * @param S  Spot price
 * @param K  Strike price
 * @param T  Time to expiry in years
 * @param r  Risk-free rate (annual, decimal)
 * @param v  Implied volatility (annual, decimal)
 * @param type  'call' | 'put'
 */
export function blackScholes(
  S: number, K: number, T: number, r: number, v: number, type: OptionType
): number {
  if (T <= 0) return Math.max(0, type === 'call' ? S - K : K - S)
  const sqrtT = Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r + 0.5 * v ** 2) * T) / (v * sqrtT)
  const d2 = d1 - v * sqrtT
  if (type === 'call') {
    return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2)
  }
  return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1)
}

/**
 * Compute option Greeks using Black-Scholes.
 */
export function computeGreeks(
  S: number, K: number, T: number, r: number, v: number, type: OptionType
): Greeks {
  if (T <= 0 || v <= 0) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, iv: v }
  }
  const sqrtT = Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r + 0.5 * v ** 2) * T) / (v * sqrtT)
  const d2 = d1 - v * sqrtT

  // Standard normal PDF
  const nd1 = Math.exp(-0.5 * d1 ** 2) / Math.sqrt(2 * Math.PI)

  const delta = type === 'call' ? normCDF(d1) : normCDF(d1) - 1
  const gamma = nd1 / (S * v * sqrtT)
  const theta = type === 'call'
    ? (-(S * nd1 * v) / (2 * sqrtT) - r * K * Math.exp(-r * T) * normCDF(d2)) / 365
    : (-(S * nd1 * v) / (2 * sqrtT) + r * K * Math.exp(-r * T) * normCDF(-d2)) / 365
  const vega = S * nd1 * sqrtT / 100   // per 1% vol
  const rho = type === 'call'
    ? K * T * Math.exp(-r * T) * normCDF(d2) / 100
    : -K * T * Math.exp(-r * T) * normCDF(-d2) / 100

  return {
    delta: Math.round(delta * 10000) / 10000,
    gamma: Math.round(gamma * 100000) / 100000,
    theta: Math.round(theta * 10000) / 10000,
    vega: Math.round(vega * 10000) / 10000,
    rho: Math.round(rho * 10000) / 10000,
    iv: v,
  }
}

/**
 * Compute implied volatility from option market price using bisection.
 */
export function impliedVolatility(
  marketPrice: number, S: number, K: number, T: number, r: number, type: OptionType,
  tolerance = 1e-5, maxIter = 100
): number {
  if (T <= 0) return 0
  let lo = 0.001, hi = 5.0
  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2
    const price = blackScholes(S, K, T, r, mid, type)
    if (Math.abs(price - marketPrice) < tolerance) return mid
    if (price > marketPrice) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

// ─── P&L helpers ─────────────────────────────────────────

export function computeOptionPnL(position: OptionPosition, underlyingPrice?: number): OptionPnL {
  const S = underlyingPrice ?? position.underlying_price ?? position.strike
  const expiry = new Date(position.expiration)
  const today = new Date()
  const daysToExpiry = Math.max(0, Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)))
  const T = daysToExpiry / 365

  const currentOptionPrice = position.current_price
    ?? blackScholes(S, position.strike, T, 0.05, 0.25, position.option_type)

  const multiplier = 100 * position.contracts * (position.is_short ? -1 : 1)
  const unrealizedPnL = (currentOptionPrice - position.premium_paid) * multiplier
  const totalPaid = Math.abs(position.premium_paid * 100 * position.contracts)
  const unrealizedPnLPct = totalPaid > 0 ? (unrealizedPnL / totalPaid) * 100 : 0

  // Max profit / loss
  let maxProfit: number, maxLoss: number
  const contractNotional = 100 * position.contracts

  if (position.option_type === 'call') {
    if (!position.is_short) {
      maxProfit = Infinity
      maxLoss = -(position.premium_paid * contractNotional)
    } else {
      maxProfit = position.premium_paid * contractNotional
      maxLoss = -Infinity
    }
  } else {
    if (!position.is_short) {
      maxProfit = (position.strike - position.premium_paid) * contractNotional
      maxLoss = -(position.premium_paid * contractNotional)
    } else {
      maxProfit = position.premium_paid * contractNotional
      maxLoss = -(position.strike - position.premium_paid) * contractNotional
    }
  }

  const breakeven = position.option_type === 'call'
    ? position.strike + position.premium_paid
    : position.strike - position.premium_paid

  return {
    unrealizedPnL: Math.round(unrealizedPnL * 100) / 100,
    unrealizedPnLPct: Math.round(unrealizedPnLPct * 100) / 100,
    maxProfit: isFinite(maxProfit) ? Math.round(maxProfit * 100) / 100 : Infinity,
    maxLoss: isFinite(maxLoss) ? Math.round(maxLoss * 100) / 100 : -Infinity,
    breakeven,
    daysToExpiry,
  }
}
