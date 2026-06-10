/**
 * Tax-loss carryforward ledger math (IRC §§1211–1212, Pub. 550 / Schedule D).
 *
 * Netting order each year:
 *   1. Short-term losses offset short-term gains; long-term losses offset
 *      long-term gains.
 *   2. A net loss in one bucket offsets a net gain in the other.
 *   3. Up to $3,000 of any remaining net loss offsets ordinary income
 *      (short-term losses are consumed first, per Schedule D ordering).
 *   4. Whatever remains carries forward to the next year, preserving its
 *      short-term / long-term character.
 *
 * All amounts are positive magnitudes in USD.
 */

export const ORDINARY_INCOME_OFFSET_CAP_USD = 3000

export interface TaxYearEntry {
  taxYear: number
  shortTermGainsUsd: number
  shortTermLossesUsd: number
  longTermGainsUsd: number
  longTermLossesUsd: number
}

export interface CarryforwardYearResult {
  taxYear: number
  /** Losses absorbed by capital gains this year (same + cross character) */
  usedAgainstGainsUsd: number
  /** Losses applied against ordinary income this year (≤ $3,000) */
  usedAgainstIncomeUsd: number
  /** Short-term loss carried into next year */
  carryforwardShortTermUsd: number
  /** Long-term loss carried into next year */
  carryforwardLongTermUsd: number
  /** Total carryforward into next year */
  carryforwardUsd: number
  /** Net taxable short-term gain after netting (0 if none) */
  netShortTermGainUsd: number
  /** Net taxable long-term gain after netting (0 if none) */
  netLongTermGainUsd: number
}

export interface CarryforwardSummary {
  years: CarryforwardYearResult[]
  /** Carryforward remaining after the final year */
  finalCarryforwardUsd: number
  finalCarryforwardShortTermUsd: number
  finalCarryforwardLongTermUsd: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Run IRS netting rules across a sequence of tax years.
 * Entries are processed in tax-year order; carryforwards from each year
 * are added to the following year's losses with character preserved.
 */
export function computeCarryforward(entries: TaxYearEntry[]): CarryforwardSummary {
  const sorted = [...entries].sort((a, b) => a.taxYear - b.taxYear)
  const years: CarryforwardYearResult[] = []

  let carryST = 0
  let carryLT = 0

  for (const entry of sorted) {
    const stGains = Math.max(0, entry.shortTermGainsUsd)
    const ltGains = Math.max(0, entry.longTermGainsUsd)
    const stLosses = Math.max(0, entry.shortTermLossesUsd) + carryST
    const ltLosses = Math.max(0, entry.longTermLossesUsd) + carryLT

    // Step 1: net within each character bucket.
    let stNet = stGains - stLosses // > 0 gain, < 0 loss
    let ltNet = ltGains - ltLosses

    let usedAgainstGains = Math.min(stGains, stLosses) + Math.min(ltGains, ltLosses)

    // Step 2: cross-character offset.
    if (stNet < 0 && ltNet > 0) {
      const offset = Math.min(-stNet, ltNet)
      stNet += offset
      ltNet -= offset
      usedAgainstGains += offset
    } else if (ltNet < 0 && stNet > 0) {
      const offset = Math.min(-ltNet, stNet)
      ltNet += offset
      stNet -= offset
      usedAgainstGains += offset
    }

    // Step 3: ordinary income offset, ST losses consumed first.
    let stLossRemaining = Math.max(0, -stNet)
    let ltLossRemaining = Math.max(0, -ltNet)
    const totalLossRemaining = stLossRemaining + ltLossRemaining
    const usedAgainstIncome = Math.min(ORDINARY_INCOME_OFFSET_CAP_USD, totalLossRemaining)

    const stUsedAgainstIncome = Math.min(stLossRemaining, usedAgainstIncome)
    const ltUsedAgainstIncome = usedAgainstIncome - stUsedAgainstIncome
    stLossRemaining -= stUsedAgainstIncome
    ltLossRemaining -= ltUsedAgainstIncome

    // Step 4: carry forward, character preserved.
    carryST = stLossRemaining
    carryLT = ltLossRemaining

    years.push({
      taxYear: entry.taxYear,
      usedAgainstGainsUsd: round2(usedAgainstGains),
      usedAgainstIncomeUsd: round2(usedAgainstIncome),
      carryforwardShortTermUsd: round2(carryST),
      carryforwardLongTermUsd: round2(carryLT),
      carryforwardUsd: round2(carryST + carryLT),
      netShortTermGainUsd: round2(Math.max(0, stNet)),
      netLongTermGainUsd: round2(Math.max(0, ltNet)),
    })
  }

  return {
    years,
    finalCarryforwardUsd: round2(carryST + carryLT),
    finalCarryforwardShortTermUsd: round2(carryST),
    finalCarryforwardLongTermUsd: round2(carryLT),
  }
}
