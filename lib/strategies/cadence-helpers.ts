/**
 * Cadence guards for strategy detectOpportunities() functions.
 *
 * Key insight: "0 opportunities found" is CORRECT for most strategies most of
 * the time. Weekly strategies should only fire on their window day; quarterly
 * strategies fire 4× per year. These guards encode exactly that — a strategy
 * returning [] because it's Tuesday is NOT a stub; it's working correctly.
 *
 * All time comparisons use a simple UTC→ET conversion (no external library).
 */

// ─── ET offset ────────────────────────────────────────────────────────────────

/** Approximate ET offset from UTC: -4 in summer (EDT), -5 in winter (EST). */
function etOffsetHours(): number {
  const now = new Date()
  const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset()
  const jul = new Date(now.getFullYear(), 6, 1).getTimezoneOffset()
  // DST: offset is smaller (less negative) during summer
  const stdOffset = Math.max(jan, jul)
  const isDst = now.getTimezoneOffset() < stdOffset
  return isDst ? -4 : -5
}

/** Date object adjusted to ET. */
function etNow(): Date {
  return new Date(Date.now() + etOffsetHours() * 3_600_000)
}

// ─── Core accessors ───────────────────────────────────────────────────────────

/** Hour of day in ET (0–23). */
export function hourEt(): number { return etNow().getUTCHours() }

/** Minute of hour in ET (0–59). */
export function minuteEt(): number { return etNow().getUTCMinutes() }

/** Day of week in ET: 0=Sun … 6=Sat. */
export function dowEt(): number { return etNow().getUTCDay() }

/** Day of month in ET (1–31). */
export function domEt(): number { return etNow().getUTCDate() }

/** Month in ET (1–12). */
export function monthEt(): number { return etNow().getUTCMonth() + 1 }

// ─── Named day checks ─────────────────────────────────────────────────────────

export function isMondayEt():  boolean { return dowEt() === 1 }
export function isFridayEt():  boolean { return dowEt() === 5 }
export function isSundayEt():  boolean { return dowEt() === 0 }
export function isWeekendEt(): boolean { const d = dowEt(); return d === 0 || d === 6 }

// ─── Market close windows ─────────────────────────────────────────────────────

/** After 4pm ET (NY market closed). */
export function isAfterNyClose(): boolean { return hourEt() >= 16 }

/** 4pm–5pm ET window (NY daily-close candle just printed). */
export function isNyCloseWindow(): boolean {
  const h = hourEt()
  return h >= 16 && h < 17
}

/** Friday after 4pm ET. */
export function isFridayEod(): boolean { return isFridayEt() && isAfterNyClose() }

/** Friday after 5pm ET (CFTC publishes COT mid-afternoon, safe after 5pm). */
export function isFridayAfter5pmEt(): boolean { return isFridayEt() && hourEt() >= 17 }

/** After 4pm ET (US market closed). Alias for isAfterNyClose. */
export function isAfterMarketClose(): boolean { return hourEt() >= 16 }

/**
 * True on the last business day (Mon–Fri) of the current month.
 * "Last business day" = the day such that the next business day is in a different month.
 */
export function isLastBusinessDayOfMonth(): boolean {
  const now = etNow()
  const dow = dowEt()
  if (dow === 0 || dow === 6) return false  // never fires on weekend
  const tomorrow = new Date(now)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  // Skip weekend — next business day
  let nextBiz = new Date(tomorrow)
  while (nextBiz.getUTCDay() === 0 || nextBiz.getUTCDay() === 6) {
    nextBiz = new Date(nextBiz.getTime() + 86_400_000)
  }
  return nextBiz.getUTCMonth() !== now.getUTCMonth()
}

/**
 * True during the 30-min window before the overnight forex roll (17:00–17:30 ET).
 * Most brokers apply swap points at 17:00 ET.
 */
export function isPreOvernightRoll(): boolean {
  const h = hourEt()
  const m = minuteEt()
  const totalMin = h * 60 + m
  return totalMin >= 16 * 60 + 30 && totalMin < 17 * 60
}

/**
 * Returns the current UTC hour as a decimal (e.g. 14h30m = 14.5).
 * Useful for London fix window checks.
 */
export function utcHourDecimal(): number {
  const now = new Date()
  return now.getUTCHours() + now.getUTCMinutes() / 60
}

/**
 * True within a given UTC hour window (inclusive start, exclusive end).
 */
export function inUtcHourWindow(startH: number, endH: number): boolean {
  const h = utcHourDecimal()
  return h >= startH && h < endH
}

/**
 * Check whether today is likely an NFP week (first Friday of month within 7 days).
 */
export function isNfpWeek(): boolean {
  const dow = dowEt()
  const dom = domEt()
  // First Friday of month: Friday where day <= 7
  if (dow === 5 && dom <= 7) return true
  // Mon–Thu before that Friday
  const daysToFirstFriday = (5 - dow + 7) % 7  // days until next Friday
  const nextFridayDom = dom + daysToFirstFriday
  return nextFridayDom <= 7
}

// ─── London open ──────────────────────────────────────────────────────────────

/**
 * True if within ±toleranceMin of London open.
 * London opens at 08:00 BST (UTC+1) = 07:00 UTC in summer,
 *                 08:00 GMT (UTC+0) = 08:00 UTC in winter.
 * We check both windows.
 */
export function isLondonOpen(toleranceMin = 10): boolean {
  const now = new Date()
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes()
  return (
    Math.abs(utcMin - 7 * 60)  <= toleranceMin ||  // BST (summer)
    Math.abs(utcMin - 8 * 60)  <= toleranceMin      // GMT (winter)
  )
}

// ─── ICT kill zones (ET) ──────────────────────────────────────────────────────

/**
 * Returns the current kill-zone name if we're in one, otherwise null.
 * Kill zones per the ICT framework (ET):
 *   London KZ  — 02:00–05:00 ET
 *   NY AM KZ   — 08:30–11:00 ET
 *   NY PM KZ   — 13:30–16:00 ET
 */
export function currentKillZone(): string | null {
  const h = hourEt()
  const m = minuteEt()
  const totalMin = h * 60 + m
  if (totalMin >= 2*60  && totalMin < 5*60)   return 'London KZ (02:00–05:00 ET)'
  if (totalMin >= 8*60+30 && totalMin < 11*60) return 'NY AM KZ (08:30–11:00 ET)'
  if (totalMin >= 13*60+30 && totalMin < 16*60) return 'NY PM KZ (13:30–16:00 ET)'
  return null
}

export function isInKillZone(): boolean { return currentKillZone() !== null }

// ─── Quarterly / monthly cadences ────────────────────────────────────────────

/**
 * True on the first business day (Mon–Fri) of Jan, Apr, Jul, or Oct.
 * "First business day" = day 1–3 of month that is a weekday.
 */
export function isFirstBusinessDayOfQuarter(): boolean {
  const m = monthEt()
  if (![1, 4, 7, 10].includes(m)) return false
  return isFirstBusinessDayOfMonth()
}

/**
 * True on the first Mon–Fri of the current month (day 1–3 that is a weekday).
 */
export function isFirstBusinessDayOfMonth(): boolean {
  const d = domEt()
  const dow = dowEt()
  if (dow === 0 || dow === 6) return false   // weekend
  return d <= 3
}

// ─── High-impact news days ────────────────────────────────────────────────────

/**
 * True if today is likely a high-impact macro day (NFP, FOMC).
 * NFP = first Friday of each month.
 * FOMC 2026 dates hardcoded (approximate).
 */
export function isHighImpactNewsDay(): boolean {
  const dow = dowEt()
  const dom = domEt()
  const m   = monthEt()

  // NFP: first Friday of month
  if (dow === 5 && dom <= 7) return true

  // FOMC 2026 meeting dates (month, day pairs — both days)
  const fomcDates: [number, number][] = [
    [1,28],[1,29],[3,18],[3,19],[5,6],[5,7],
    [6,17],[6,18],[7,29],[7,30],[9,16],[9,17],
    [11,4],[11,5],[12,16],[12,17],
  ]
  return fomcDates.some(([fm, fd]) => fm === m && (fd === dom || fd === dom - 1))
}

// ─── Sunday pre-open (for wheel + tail-risk weekly review) ───────────────────

/**
 * True on Sunday ET, optionally requiring a minimum hour
 * (e.g., after 18:00 ET = "Sunday EOD").
 */
export function isSundayEod(afterHour = 18): boolean {
  return isSundayEt() && hourEt() >= afterHour
}

// ─── Cadence metadata (for dashboard) ────────────────────────────────────────

export interface StrategyCadenceMeta {
  cadence: string
  windowDescription: string
  nextWindowHint: string
}

export const STRATEGY_CADENCE: Record<string, StrategyCadenceMeta> = {
  // Stocks
  vcp_minervini:            { cadence: 'Daily EOD',        windowDescription: 'After 4pm ET market close',                  nextWindowHint: 'Today 4pm ET' },
  quant_momentum:           { cadence: 'Quarterly',        windowDescription: 'First business day of Jan / Apr / Jul / Oct', nextWindowHint: 'First weekday of next quarter-start month' },
  qvm_multifactor:          { cadence: 'Quarterly',        windowDescription: 'First business day of Jan / Apr / Jul / Oct', nextWindowHint: 'First weekday of next quarter-start month' },
  dividend_aristocrat:      { cadence: 'Quarterly',        windowDescription: 'First business day of Jan / Apr / Jul / Oct', nextWindowHint: 'First weekday of next quarter-start month' },
  sector_rotation:          { cadence: 'Monthly + macro',  windowDescription: 'First business day of month or macro trigger', nextWindowHint: 'First weekday of next month' },
  pead:                     { cadence: 'Earnings season',  windowDescription: 'Within 1 trading day of earnings release',   nextWindowHint: 'Next earnings report in watchlist' },
  options_wheel:            { cadence: 'Weekly',           windowDescription: 'Sunday EOD or Monday pre-open',              nextWindowHint: 'This Sunday 6pm ET' },
  gamma_exposure:           { cadence: 'Intraday',         windowDescription: 'Pre-market 8:30am ET + every 30 min',        nextWindowHint: 'Tomorrow 8:30am ET' },
  merger_arb:               { cadence: 'Weekly',           windowDescription: 'Weekly EDGAR scan (any day)',                nextWindowHint: 'Next Monday' },
  spinoff:                  { cadence: 'Weekly Monday',    windowDescription: 'Monday only — EDGAR Form 10 scan',           nextWindowHint: 'Next Monday' },
  tail_risk_hedging:        { cadence: 'Weekly + spike',   windowDescription: 'Sunday EOD or VIX > 30',                    nextWindowHint: 'This Sunday 6pm ET' },
  autopilot_congressional:  { cadence: 'Daily 4pm ET',     windowDescription: 'After 4pm ET (PTR scrape)',                  nextWindowHint: 'Today 4pm ET' },
  // Crypto
  dca_halving:              { cadence: 'Weekly + cycle',   windowDescription: 'Monday weekly DCA + daily cycle overlay',    nextWindowHint: 'Next Monday' },
  onchain_signal:           { cadence: 'Hourly',           windowDescription: 'Every hour — fires when 5-of-5 align',      nextWindowHint: 'Next hour (fires rarely)' },
  defi_yield:               { cadence: 'Weekly Sunday',    windowDescription: 'Sunday only',                               nextWindowHint: 'This Sunday' },
  narrative_rotation:       { cadence: 'Weekly Monday',    windowDescription: 'Monday only',                               nextWindowHint: 'Next Monday' },
  liquidation_hunting:      { cadence: 'Continuous',       windowDescription: 'Every run — fires on cluster + reversal',   nextWindowHint: 'Next paper pass' },
  airdrop_farming:          { cadence: 'Weekly Monday',    windowDescription: 'Monday only',                               nextWindowHint: 'Next Monday' },
  memecoin_bondingcurve:    { cadence: 'Continuous',       windowDescription: 'Every run — fires on boosted tokens',       nextWindowHint: 'Next paper pass' },
  funding_basis_arb:        { cadence: 'Continuous',       windowDescription: 'Every run — fires when funding elevated',   nextWindowHint: 'Next paper pass' },
  cex_latency_arb:          { cadence: 'Continuous',       windowDescription: 'Every run — fires when spread found',       nextWindowHint: 'Next paper pass' },
  // Forex
  ict_smc:                  { cadence: 'Kill zones',       windowDescription: '02–05 ET, 08:30–11 ET, 13:30–16 ET',       nextWindowHint: 'Next kill zone window' },
  carry_trade:              { cadence: 'Weekly Friday EOD',windowDescription: 'Friday after 4pm ET',                       nextWindowHint: 'This Friday 4pm ET' },
  cot_positioning:          { cadence: 'Weekly Friday',    windowDescription: 'Friday after 5pm ET (CFTC release)',        nextWindowHint: 'This Friday 5pm ET' },
  cb_divergence:            { cadence: 'CB meeting weeks', windowDescription: 'Within 7 days of major CB meeting',         nextWindowHint: 'Next central bank meeting' },
  session_breakout:         { cadence: 'Daily London open',windowDescription: '07:00–08:00 UTC (London open)',             nextWindowHint: 'Tomorrow 07:00 UTC' },
  fx_trendfollowing:        { cadence: 'Daily NY close',   windowDescription: '4pm–5pm ET',                               nextWindowHint: 'Today 4pm ET' },
  macro_news_event:         { cadence: 'After releases',   windowDescription: '5–60 min after high-impact release',        nextWindowHint: 'Next NFP / CPI / FOMC' },
  triangular_arb:           { cadence: 'Continuous',       windowDescription: 'Every run — fires when arb found',          nextWindowHint: 'Next paper pass' },
  correlation_divergence:   { cadence: 'Daily NY close',   windowDescription: '4pm–5pm ET',                               nextWindowHint: 'Today 4pm ET' },
  // Polymarket (all continuous)
  polymarket_resolution_rules:    { cadence: 'Continuous', windowDescription: 'Every run',  nextWindowHint: 'Next paper pass' },
  polymarket_base_rate:           { cadence: 'Continuous', windowDescription: 'Every run',  nextWindowHint: 'Next paper pass' },
  polymarket_cross_market:        { cadence: 'Continuous', windowDescription: 'Every run',  nextWindowHint: 'Next paper pass' },
  polymarket_event_compression:   { cadence: 'Continuous', windowDescription: 'Every run',  nextWindowHint: 'Next paper pass' },
  polymarket_narrative_fade:      { cadence: 'Continuous', windowDescription: 'Every run',  nextWindowHint: 'Next paper pass' },
  polymarket_liquidity_pocket:    { cadence: 'Continuous', windowDescription: 'Every run',  nextWindowHint: 'Next paper pass' },
  polymarket_no_trade:            { cadence: 'Never',      windowDescription: 'Always empty — no-trade filter', nextWindowHint: 'Never' },
  polymarket_info_lag:            { cadence: 'Continuous', windowDescription: 'Every run',  nextWindowHint: 'Next paper pass' },
  polymarket_crypto_binary_5min:  { cadence: 'Continuous', windowDescription: 'Every run',  nextWindowHint: 'Next paper pass' },
  polymarket_wallet_copy:         { cadence: 'Continuous', windowDescription: 'Every run',  nextWindowHint: 'Next paper pass' },
  // Tier 3
  activist_13d_insider_cluster:         { cadence: 'Daily EOD',       windowDescription: 'After 4pm ET, non-earnings window', nextWindowHint: 'Today 4pm ET' },
  buyback_announcement_momentum:        { cadence: 'Daily EOD',       windowDescription: 'After 4pm ET or pre-market',        nextWindowHint: 'Today 4pm ET' },
  etf_basis_arb:                        { cadence: 'Continuous',      windowDescription: 'Every run — fires on ETF/perp gap', nextWindowHint: 'Next paper pass' },
  lst_basis_arb:                        { cadence: 'Continuous',      windowDescription: 'Every run — fires on LST discount', nextWindowHint: 'Next paper pass' },
  rwa_yield_stack:                      { cadence: 'Weekly Monday',   windowDescription: 'Monday — RWA yield vs T-bill',      nextWindowHint: 'Next Monday' },
  london_4pm_fix_endmonth:              { cadence: 'Monthly (London)', windowDescription: 'Last business day of month, London 14:00–16:30 UTC', nextWindowHint: 'Last business day of this month' },
  swap_point_arbitrage:                 { cadence: 'Daily pre-roll',  windowDescription: '16:30–17:00 ET (pre-overnight roll)', nextWindowHint: 'Today 4:30pm ET' },
  prediction_market_sportsbook_arb:     { cadence: 'Continuous',      windowDescription: 'Every run — fires on PM/SB margin', nextWindowHint: 'Next paper pass' },
}

/** Return cadence metadata for a strategy key, with live in-window status. */
export function getCadenceMeta(strategyKey: string): StrategyCadenceMeta & { inWindow: boolean } {
  const meta = STRATEGY_CADENCE[strategyKey] ?? {
    cadence: 'Unknown',
    windowDescription: 'Unknown',
    nextWindowHint: 'Unknown',
  }
  return { ...meta, inWindow: isCurrentlyInWindow(strategyKey) }
}

function isCurrentlyInWindow(key: string): boolean {
  switch (key) {
    case 'vcp_minervini':
    case 'autopilot_congressional':
    case 'fx_trendfollowing':
    case 'correlation_divergence':   return isNyCloseWindow() || isAfterNyClose()
    case 'quant_momentum':
    case 'qvm_multifactor':
    case 'dividend_aristocrat':      return isFirstBusinessDayOfQuarter()
    case 'sector_rotation':          return isFirstBusinessDayOfMonth()
    case 'options_wheel':            return isSundayEod() || (isMondayEt() && hourEt() < 9)
    case 'spinoff':
    case 'narrative_rotation':
    case 'airdrop_farming':          return isMondayEt()
    case 'tail_risk_hedging':        return isSundayEod()
    case 'defi_yield':               return isSundayEt()
    case 'carry_trade':              return isFridayEod()
    case 'cot_positioning':          return isFridayAfter5pmEt()
    case 'ict_smc':                  return isInKillZone()
    case 'session_breakout':         return isLondonOpen(15)
    case 'macro_news_event':         return true   // checked inside strategy
    case 'cb_divergence':            return true   // checked inside strategy
    case 'pead':                     return true   // checked inside strategy (earnings calendar)
    case 'onchain_signal':           return true   // hourly, always in window
    // Tier 3
    case 'activist_13d_insider_cluster':
    case 'buyback_announcement_momentum':  return isAfterMarketClose()
    case 'rwa_yield_stack':                return isMondayEt()
    case 'london_4pm_fix_endmonth':        return isLastBusinessDayOfMonth() && inUtcHourWindow(14, 16.5)
    case 'swap_point_arbitrage':           return isPreOvernightRoll()
    // continuous strategies
    default:                         return true
  }
}
