/**
 * Color (∂Γ/∂t) — gamma-decay timing indicator
 *
 * Color measures how fast gamma is changing with respect to time. Near expiry,
 * gamma for ATM options accelerates sharply, forcing dealers to rehedge in
 * predictable windows. This indicator maps those windows and the expected
 * flow direction given a net-gamma proxy.
 *
 * Hedge windows (ET): 10:00, 12:00, 14:30, 15:45
 * Direction: long gamma → dealers buy dips / sell rips (mean-reversion flow)
 *            short gamma → dealers chase moves (trend-amplifying flow)
 */

export interface ColorDecaySchedule {
  /** ISO timestamp of the next intraday hedge window (ET clock converted to UTC). */
  nextHedgeWindow: string
  /** Expected net order flow during that window. */
  expectedFlowDirection: 'buy' | 'sell' | 'neutral'
  /** Confidence in the prediction [0, 1]. */
  confidence: number
}

// ET hedge windows expressed as [hour, minute] in local ET (UTC-5 standard / UTC-4 DST)
const HEDGE_WINDOWS_ET: [number, number][] = [
  [10,  0],
  [12,  0],
  [14, 30],
  [15, 45],
]

/** Returns minutes-to-next-hedge-window and the window's [h, m]. */
function nextWindowFromEtMinuteOfDay(etMinuteOfDay: number): {
  minutesAway: number
  windowHour: number
  windowMinute: number
} {
  for (const [h, m] of HEDGE_WINDOWS_ET) {
    const windowMinute = h * 60 + m
    if (windowMinute > etMinuteOfDay) {
      return { minutesAway: windowMinute - etMinuteOfDay, windowHour: h, windowMinute: m }
    }
  }
  // Past last window — next day's first window
  const [h, m] = HEDGE_WINDOWS_ET[0]
  const nextDayMinutes = 24 * 60 - etMinuteOfDay + h * 60 + m
  return { minutesAway: nextDayMinutes, windowHour: h, windowMinute: m }
}

/**
 * Compute the gamma-decay hedging schedule.
 *
 * @param netGammaUsd  Net gamma exposure in USD notional (positive = long gamma,
 *                     negative = short gamma). Used as a VIX-proxy: pass
 *                     (vix - 20) * 1_000 for a rough market-wide estimate.
 * @param currentTime  Reference timestamp (defaults to now).
 */
export function computeColorDecaySchedule(
  netGammaUsd: number,
  currentTime: Date = new Date(),
): ColorDecaySchedule {
  // Detect DST: US Eastern is UTC-5 (EST) or UTC-4 (EDT).
  // Simple proxy: months 3–10 (Mar–Oct) use EDT (UTC-4), others EST (UTC-5).
  const month = currentTime.getUTCMonth() + 1 // 1-indexed
  const etOffsetHours = month >= 3 && month <= 10 ? -4 : -5
  const etMs = currentTime.getTime() + etOffsetHours * 3_600_000
  const etDate = new Date(etMs)
  const etHour = etDate.getUTCHours()
  const etMinute = etDate.getUTCMinutes()
  const etMinuteOfDay = etHour * 60 + etMinute
  const isOpexDay = isMonthlyOpex(currentTime)

  const { minutesAway, windowHour, windowMinute } = nextWindowFromEtMinuteOfDay(etMinuteOfDay)

  // Build UTC timestamp for that window
  const windowEtMs = etMs - etMinuteOfDay * 60_000 + (windowHour * 60 + windowMinute) * 60_000
  // If window is past today (wrapped to next day), add a day
  const wrappedBack = windowHour * 60 + windowMinute <= etMinuteOfDay
  const windowUtcMs = windowEtMs - etOffsetHours * 3_600_000 + (wrappedBack ? 86_400_000 : 0)
  const nextHedgeWindow = new Date(windowUtcMs).toISOString()

  // Flow direction: long gamma → mean-reversion (buy dips / sell rips)
  //                short gamma → trend-amplifying
  // We determine direction relative to market drift assumption (long gamma = buy,
  // meaning dealers are buying to rehedge when price falls).
  let expectedFlowDirection: 'buy' | 'sell' | 'neutral' = 'neutral'
  if (Math.abs(netGammaUsd) > 500) {
    expectedFlowDirection = netGammaUsd > 0 ? 'buy' : 'sell'
  }

  // Confidence: higher when close to a window, highest on opex day near close
  const decayMinutes = 30 // half-life of confidence signal
  const proximityConf = Math.exp(-minutesAway / decayMinutes)
  // Boost near market close (ET 14:30–16:00) and on opex day
  const closeBoost = etMinuteOfDay >= 870 && etMinuteOfDay < 960 ? 0.15 : 0 // 14:30–16:00
  const opexBoost  = isOpexDay ? 0.10 : 0
  const confidence = Math.min(1, proximityConf + closeBoost + opexBoost)

  return { nextHedgeWindow, expectedFlowDirection, confidence }
}

/** True when currentTime is the third Friday of the month (monthly SPX opex). */
export function isMonthlyOpex(currentTime: Date): boolean {
  // Find the day of week and which Friday-of-month this is
  const utcDay = currentTime.getUTCDay() // 0=Sun, 5=Fri
  if (utcDay !== 5) return false
  const dom = currentTime.getUTCDate()
  // Third Friday: day 15–21
  return dom >= 15 && dom <= 21
}
