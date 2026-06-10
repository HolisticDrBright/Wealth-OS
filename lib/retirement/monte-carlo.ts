/**
 * Monte Carlo retirement simulation.
 *
 * Simulates many possible market paths instead of a single deterministic
 * projection. Annual returns are drawn from a normal distribution
 * (mean = expected_return_pct, stdev derived from an asset-mix heuristic),
 * inflation from a normal distribution (mean 3%, stdev 1%). Each path runs
 * the accumulation phase with annual contributions, then a retirement
 * drawdown of the inflation-adjusted target income through `endAge`.
 *
 * Uses a small seedable PRNG (mulberry32) so results are deterministic
 * for a given seed — no external dependencies.
 */

export interface MonteCarloPlanInput {
  current_age?: number
  target_retirement_age: number
  current_savings_usd: number
  annual_contribution_usd: number
  expected_return_pct: number
  target_monthly_income_usd?: number
  social_security_monthly_usd?: number
  pension_monthly_usd?: number
}

export interface MonteCarloOptions {
  /** Number of simulated paths. Default 1000. */
  paths?: number
  /** PRNG seed for deterministic results. Default 42. */
  seed?: number
  /**
   * Annual return stdev (percent). If omitted, derived from an asset-mix
   * heuristic based on the expected return (equity-heavy ≈ 12%).
   */
  returnStdevPct?: number
  /** Mean annual inflation (percent). Default 3. */
  inflationMeanPct?: number
  /** Annual inflation stdev (percent). Default 1. */
  inflationStdevPct?: number
  /** Age the money must last to. Default 95. */
  endAge?: number
}

export interface PercentileBand {
  /** Years from today (0 = now). */
  year: number
  age: number
  phase: 'accumulation' | 'retirement'
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}

export interface MonteCarloResult {
  /** Fraction of paths where money lasted to endAge (0..1). */
  successProbability: number
  /** Per-year percentile bands of portfolio balance. */
  bands: PercentileBand[]
  /** Median age at which failed paths ran out of money. Null if no failures. */
  medianDepletionAge: number | null
  /** Number of simulated paths. */
  paths: number
  /** Age the simulation runs to. */
  endAge: number
  /** Stdev (percent) actually used for return draws. */
  returnStdevPct: number
}

/** mulberry32 — tiny, fast, seedable 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normal draw via Box–Muller transform on a uniform PRNG. */
function normalDraw(rng: () => number): number {
  // Guard against log(0)
  const u1 = Math.max(rng(), 1e-12)
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/**
 * Asset-mix heuristic: infer return volatility from the expected return.
 * Higher expected returns imply heavier equity allocations and thus higher
 * volatility. Equity-heavy portfolios default to ~12% annual stdev.
 */
export function deriveReturnStdevPct(expectedReturnPct: number): number {
  if (expectedReturnPct >= 7) return 12 // equity-heavy
  if (expectedReturnPct >= 5.5) return 10 // balanced
  if (expectedReturnPct >= 4) return 7 // conservative
  return 4 // cash/bond heavy
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

export function runMonteCarloRetirement(
  plan: MonteCarloPlanInput,
  options: MonteCarloOptions = {}
): MonteCarloResult {
  const paths = options.paths ?? 1000
  const seed = options.seed ?? 42
  const returnStdevPct = options.returnStdevPct ?? deriveReturnStdevPct(plan.expected_return_pct)
  const inflationMean = (options.inflationMeanPct ?? 3) / 100
  const inflationStdev = (options.inflationStdevPct ?? 1) / 100
  const endAge = options.endAge ?? 95

  const currentAge = plan.current_age ?? 35
  const retirementAge = Math.max(currentAge, plan.target_retirement_age)
  const yearsToRetirement = retirementAge - currentAge
  const totalYears = Math.max(0, endAge - currentAge)

  const returnMean = plan.expected_return_pct / 100
  const returnStdev = returnStdevPct / 100

  // Annual income needed from the portfolio (today's dollars); social
  // security and pension offset the target before the portfolio is tapped.
  const otherIncomeMonthly =
    (plan.social_security_monthly_usd ?? 0) + (plan.pension_monthly_usd ?? 0)
  const targetMonthly = plan.target_monthly_income_usd ?? 5000
  const annualNeedToday = Math.max(0, targetMonthly - otherIncomeMonthly) * 12

  const rng = mulberry32(seed)

  // balancesByYear[y] = balance of every path at year y (0 = today)
  const balancesByYear: number[][] = Array.from({ length: totalYears + 1 }, () => [])
  const depletionAges: number[] = []
  let successes = 0

  for (let p = 0; p < paths; p++) {
    let balance = plan.current_savings_usd
    let priceLevel = 1 // cumulative inflation factor for this path
    let depleted = false

    balancesByYear[0].push(balance)

    for (let y = 1; y <= totalYears; y++) {
      const annualReturn = returnMean + returnStdev * normalDraw(rng)
      const inflation = inflationMean + inflationStdev * normalDraw(rng)
      priceLevel *= 1 + inflation

      if (y <= yearsToRetirement) {
        // Accumulation: grow, then contribute.
        balance = balance * (1 + annualReturn) + plan.annual_contribution_usd
      } else {
        // Retirement: grow, then withdraw the inflation-adjusted need.
        balance = balance * (1 + annualReturn) - annualNeedToday * priceLevel
      }

      if (balance <= 0 && y > yearsToRetirement && !depleted) {
        depleted = true
        depletionAges.push(currentAge + y)
      }
      balance = Math.max(0, balance)
      balancesByYear[y].push(balance)
    }

    // Success = money lasted to endAge (only meaningful if there is a need).
    if (!depleted) successes++
  }

  const bands: PercentileBand[] = balancesByYear.map((balances, y) => {
    const sorted = [...balances].sort((a, b) => a - b)
    return {
      year: y,
      age: currentAge + y,
      phase: y <= yearsToRetirement ? 'accumulation' : 'retirement',
      p10: percentile(sorted, 0.1),
      p25: percentile(sorted, 0.25),
      p50: percentile(sorted, 0.5),
      p75: percentile(sorted, 0.75),
      p90: percentile(sorted, 0.9),
    }
  })

  depletionAges.sort((a, b) => a - b)
  const medianDepletionAge =
    depletionAges.length > 0
      ? depletionAges[Math.floor(depletionAges.length / 2)]
      : null

  return {
    successProbability: paths > 0 ? successes / paths : 0,
    bands,
    medianDepletionAge,
    paths,
    endAge,
    returnStdevPct,
  }
}
