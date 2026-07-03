/**
 * TIPP floor state transitions (Remaining brief R2) — pure math over the
 * persisted sleeve_floors rows. F_t = max(F_prev × e^(r·dt), k × V_t);
 * the floor only ever rises. Explicit user resets require a typed phrase
 * and are logged — nothing else may lower a floor.
 */

import { tippFloor } from './sweep-engine'

export interface FloorState {
  floorUsd: number
  hwmUsd: number
  peakCushionUsd: number
}

export const RESET_PHRASE = 'RESET FLOOR'

/**
 * Daily update. r = current risk-free (fraction/yr, from live yields);
 * dtDays since the last update.
 */
export function updateFloorState(
  prev: FloorState,
  sleeveValueUsd: number,
  k: number,
  rAnnual: number,
  dtDays: number
): FloorState {
  const growth = Math.exp(Math.max(0, rAnnual) * (Math.max(0, dtDays) / 365))
  const floorUsd = tippFloor(prev.floorUsd, sleeveValueUsd, k, growth)
  const hwmUsd = Math.max(prev.hwmUsd, sleeveValueUsd)
  const cushion = Math.max(0, sleeveValueUsd - floorUsd)
  return {
    floorUsd,
    hwmUsd,
    peakCushionUsd: Math.max(prev.peakCushionUsd, cushion),
  }
}

/** Explicit reset: typed confirmation required; returns the log entry to persist. */
export function resetFloorState(
  typedConfirmation: string,
  reason: string,
  sleeveValueUsd: number,
  k: number
): { state: FloorState; logEntry: Record<string, unknown> } | { error: string } {
  if (typedConfirmation !== RESET_PHRASE) {
    return { error: `typed confirmation required: ${RESET_PHRASE}` }
  }
  if (!reason.trim()) return { error: 'a reason is required — resets are logged' }
  return {
    state: {
      floorUsd: k * sleeveValueUsd,
      hwmUsd: sleeveValueUsd,
      peakCushionUsd: Math.max(0, sleeveValueUsd * (1 - k)),
    },
    logEntry: { at: new Date().toISOString(), reason: reason.trim(), valueUsd: sleeveValueUsd },
  }
}
