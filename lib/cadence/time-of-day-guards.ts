/**
 * Time-of-day guards for each asset class (T4.3).
 *
 * Prevents entering positions during low-liquidity or high-risk windows.
 *
 * Stocks (ET):
 *   - Skip 09:30–10:00 (opening auction overhang)
 *   - Skip 15:45–16:00 (MOC order flow / mark-up risk)
 *   - Skip 12:00–13:00 (midday lull — thin book)
 *
 * Crypto (UTC):
 *   - Skip ±5 min around funding settlements: 00:00, 08:00, 16:00 UTC
 *
 * Forex (ET):
 *   - Skip 17:00–22:00 ET (NY→Sydney rollover, thin liquidity)
 *
 * Polymarket:
 *   - Always allowed (market-age guard belongs in strategy logic)
 */

import type { AssetClass } from '@/lib/strategies/strategy-registry'

// ─── Internal clock helpers ───────────────────────────────────────────────────

function etHourDecimal(): number {
  const now = new Date()
  // ET is UTC-5 (EST) or UTC-4 (EDT). Use a fixed UTC-5 offset for simplicity;
  // actual DST awareness would require a tz library.
  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60
  const etH = ((utcH - 5) + 24) % 24
  return etH
}

function utcHourDecimal(): number {
  const now = new Date()
  return now.getUTCHours() + now.getUTCMinutes() / 60
}

// ─── Per-asset-class guards ───────────────────────────────────────────────────

function stocksAllowed(): boolean {
  const et = etHourDecimal()
  if (et >= 9.5 && et < 10.0)  return false   // opening 30 min
  if (et >= 15.75 && et < 16.0) return false  // last 15 min
  if (et >= 12.0 && et < 13.0)  return false  // midday lull
  return true
}

function cryptoAllowed(): boolean {
  const utc = utcHourDecimal()
  const settlements = [0, 8, 16]
  const WINDOW = 5 / 60   // ±5 minutes expressed as fractional hours
  for (const s of settlements) {
    const dist = Math.min(Math.abs(utc - s), Math.abs(utc - s - 24), Math.abs(utc - s + 24))
    if (dist < WINDOW) return false
  }
  return true
}

function forexAllowed(): boolean {
  const et = etHourDecimal()
  // 17:00–22:00 ET — NY close through early Sydney, very thin liquidity
  if (et >= 17.0 && et < 22.0) return false
  return true
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns false when the current time falls inside a blocked window for the
 * given asset class. Always returns true for 'polymarket', 'multi-asset',
 * 'options' (guards not specified for those classes).
 */
export function isTimeOfDayAllowed(assetClass: AssetClass, _strategyKey?: string): boolean {
  switch (assetClass) {
    case 'stocks':
    case 'options':
      return stocksAllowed()
    case 'crypto':
      return cryptoAllowed()
    case 'forex':
      return forexAllowed()
    case 'polymarket':
    case 'multi-asset':
      return true
  }
}
