/**
 * Empirical Kelly sizing with maturity and calibration haircuts.
 * Never increases position size — only applies downward haircuts.
 */
import type { StrategyMaturityStatus } from './strategy-registry'

const MATURITY_HAIRCUT: Record<StrategyMaturityStatus, number> = {
  stub:           0,    // must never trade
  backtest_ready: 0.1,  // 90% haircut
  paper_trading:  0.5,  // 50% haircut
  live_candidate: 0.75, // 25% haircut
  live_disabled:  0,    // must never trade
  retired:        0,    // must never trade
}

export interface EmpiricalKellyParams {
  kellyFraction: number    // raw quarter-kelly from risk-controls
  maturityStatus: StrategyMaturityStatus
  brierScore?: number      // rolling 90-day Brier score [0,1]; lower is better
  correlationPenalty?: number // [0,1]; 1=fully correlated to portfolio, cuts fraction
}

export interface EmpiricalKellyResult {
  fraction: number  // final fraction to use for sizing
  haircut: number   // total multiplicative haircut applied (for audit logging)
  blocked: boolean  // true when maturity blocks execution entirely
}

export function empiricalKelly(params: EmpiricalKellyParams): EmpiricalKellyResult {
  const { kellyFraction, maturityStatus, brierScore, correlationPenalty = 0 } = params

  const maturityMult = MATURITY_HAIRCUT[maturityStatus]
  if (maturityMult === 0) {
    return { fraction: 0, haircut: 1, blocked: true }
  }

  // Brier calibration multiplier: well-calibrated (score→0) = 1.0, random (score=0.25) = 0.5
  // Brier score of 0 = perfect, 1 = worst. Typical range 0.05–0.25.
  const brierMult = brierScore != null
    ? Math.max(0.5, 1 - brierScore * 2)
    : 1.0

  // Correlation penalty: reduces sizing when strategy is correlated to existing positions
  const corrMult = Math.max(0, 1 - correlationPenalty)

  const haircut = 1 - (maturityMult * brierMult * corrMult)
  const fraction = Math.max(0, kellyFraction * maturityMult * brierMult * corrMult)

  return { fraction, haircut, blocked: false }
}
