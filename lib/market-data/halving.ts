/**
 * Bitcoin halving cycle data and DCA phase classifier.
 *
 * Historical halvings:
 *   1st: 2012-11-28  (block 210,000)
 *   2nd: 2016-07-09  (block 420,000)
 *   3rd: 2020-05-11  (block 630,000)
 *   4th: 2024-04-19  (block 840,000)
 *   5th: ~2028-03-xx (block 1,050,000) — estimated
 *
 * Cycle phases (days since last halving):
 *   Accumulation  : 0–365   (year 1) — buy dips, build position
 *   Expansion     : 366–730  (year 2) — ride momentum, no new buys on peaks
 *   Distribution  : 731–1095 (year 3) — trim on strength, watch for blow-off
 *   Contraction   : 1096+   (year 4) — reduce to core position, wait for next halving
 */

export type HalvingPhase = 'accumulation' | 'expansion' | 'distribution' | 'contraction'

const HALVING_DATES: Date[] = [
  new Date('2012-11-28'),
  new Date('2016-07-09'),
  new Date('2020-05-11'),
  new Date('2024-04-19'),
  new Date('2028-03-15'), // estimated
]

export interface HalvingCycleState {
  lastHalvingDate: Date
  nextHalvingDate: Date
  daysSinceHalving: number
  daysToNextHalving: number
  phase: HalvingPhase
  cycleProgressPct: number  // 0–100
}

export function getHalvingCycleState(asOf = new Date()): HalvingCycleState {
  const now = asOf.getTime()

  // Find the most recent halving that has already passed
  let lastHalving = HALVING_DATES[0]
  let nextHalving = HALVING_DATES[1]

  for (let i = 0; i < HALVING_DATES.length - 1; i++) {
    if (HALVING_DATES[i].getTime() <= now && HALVING_DATES[i + 1].getTime() > now) {
      lastHalving = HALVING_DATES[i]
      nextHalving = HALVING_DATES[i + 1]
      break
    }
  }

  const msPerDay = 24 * 60 * 60 * 1000
  const daysSince = Math.floor((now - lastHalving.getTime()) / msPerDay)
  const daysToNext = Math.floor((nextHalving.getTime() - now) / msPerDay)
  const cycleLengthDays = Math.floor((nextHalving.getTime() - lastHalving.getTime()) / msPerDay)
  const cycleProgressPct = Math.min(100, (daysSince / cycleLengthDays) * 100)

  let phase: HalvingPhase
  if (daysSince <= 365) phase = 'accumulation'
  else if (daysSince <= 730) phase = 'expansion'
  else if (daysSince <= 1095) phase = 'distribution'
  else phase = 'contraction'

  return { lastHalvingDate: lastHalving, nextHalvingDate: nextHalving, daysSinceHalving: daysSince, daysToNextHalving: daysToNext, phase, cycleProgressPct }
}

/**
 * DCA buy signal for the accumulation phase.
 *
 * Signal fires when:
 *   - Phase is 'accumulation' or 'contraction' (pre-halving accumulation)
 *   - Price is >= X% below its 90-day high (a dip worth buying)
 *
 * @param currentPrice   Latest BTC close price
 * @param ninetyDayHigh  90-day highest close
 * @param dipThreshold   Required dip from high to trigger (default 15%)
 */
export function getDCASignal(
  currentPrice: number,
  ninetyDayHigh: number,
  dipThreshold = 0.15
): { signal: 'buy' | 'hold' | 'reduce'; strength: number; reason: string } {
  const state = getHalvingCycleState()
  const dipFromHigh = (ninetyDayHigh - currentPrice) / ninetyDayHigh

  if (state.phase === 'accumulation') {
    if (dipFromHigh >= dipThreshold) {
      const strength = Math.min(1, dipFromHigh / 0.40)
      return { signal: 'buy', strength, reason: `Accumulation phase — ${(dipFromHigh * 100).toFixed(1)}% dip from 90d high` }
    }
    return { signal: 'hold', strength: 0, reason: `Accumulation phase but only ${(dipFromHigh * 100).toFixed(1)}% from high — wait for deeper dip` }
  }

  if (state.phase === 'contraction') {
    if (dipFromHigh >= dipThreshold * 1.5) {
      const strength = Math.min(0.7, dipFromHigh / 0.60)
      return { signal: 'buy', strength, reason: `Pre-halving contraction — ${(dipFromHigh * 100).toFixed(1)}% dip, building position for next cycle` }
    }
    return { signal: 'hold', strength: 0, reason: 'Contraction phase — waiting for deeper dip before accumulating' }
  }

  if (state.phase === 'distribution') {
    // In distribution, only reduce on strength, not buy
    if (dipFromHigh < 0.05) {
      return { signal: 'reduce', strength: 0.6, reason: `Distribution phase — within 5% of 90d high, trimming position` }
    }
    return { signal: 'hold', strength: 0, reason: 'Distribution phase — holding existing position' }
  }

  // Expansion: let momentum run, small buys on minor dips
  if (dipFromHigh >= dipThreshold * 0.5) {
    return { signal: 'buy', strength: Math.min(0.5, dipFromHigh / 0.20), reason: `Expansion phase — ${(dipFromHigh * 100).toFixed(1)}% pullback` }
  }
  return { signal: 'hold', strength: 0, reason: 'Expansion phase — no meaningful dip' }
}
