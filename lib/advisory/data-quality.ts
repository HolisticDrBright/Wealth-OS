/**
 * Data-quality / advice-confidence labels (validation item 10).
 *
 * Every wealth recommendation carries an explicit label: how complete the
 * inputs were, what is missing, whether rates/tax constants are current,
 * and that it is educational planning requiring professional review.
 * The app never overclaims — a thin profile produces LOW confidence, not
 * confident-sounding guesses.
 */

export interface DataQualityLabel {
  /** 0–100: share of the inputs this item needed that were actually present. */
  completenessPct: number
  confidence: 'high' | 'medium' | 'low'
  /** Human-readable names of the inputs that are missing. */
  missingInputs: string[]
  /** null = this item does not depend on market rates. */
  ratesCurrent: boolean | null
  /** null = this item does not depend on tax constants. */
  taxConstantsCurrent: boolean | null
  /** Always true for anything tax- or account-structure-related. */
  requiresProfessionalReview: boolean
  /** Always true — this product gives educational planning, not advice. */
  informationalOnly: true
}

export const RATE_FRESHNESS_HOURS = 24 * 7      // yields older than a week → stale
export const TAX_CONSTANT_FRESHNESS_DAYS = 90   // matches the advisory staleness cron

export function isFresh(iso: string | null | undefined, maxAgeMs: number): boolean | null {
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (!isFinite(t)) return false
  return Date.now() - t <= maxAgeMs
}

/**
 * Build the label from the inputs an item declared it needs vs what was
 * actually available. `presentInputs`/`missingInputs` are human-readable.
 */
export function buildQualityLabel(args: {
  presentInputs: string[]
  missingInputs: string[]
  /** ISO timestamp of the yield snapshot, null when rates are irrelevant. */
  yieldsFetchedAt?: string | null
  usesRates?: boolean
  /** ISO timestamp of the newest tax-constant verification. */
  taxConstantsVerifiedAt?: string | null
  usesTaxConstants?: boolean
  requiresProfessionalReview: boolean
}): DataQualityLabel {
  const total = args.presentInputs.length + args.missingInputs.length
  const completenessPct = total === 0 ? 100
    : Math.round((args.presentInputs.length / total) * 100)

  const ratesCurrent = args.usesRates
    ? isFresh(args.yieldsFetchedAt, RATE_FRESHNESS_HOURS * 3_600_000)
    : null
  const taxConstantsCurrent = args.usesTaxConstants
    ? isFresh(args.taxConstantsVerifiedAt, TAX_CONSTANT_FRESHNESS_DAYS * 86_400_000)
    : null

  // Confidence: completeness dominates; stale rates/constants cap it at medium.
  let confidence: DataQualityLabel['confidence'] =
    completenessPct >= 90 ? 'high' : completenessPct >= 60 ? 'medium' : 'low'
  if (ratesCurrent === false || taxConstantsCurrent === false) {
    confidence = confidence === 'high' ? 'medium' : 'low'
  }

  return {
    completenessPct,
    confidence,
    missingInputs: args.missingInputs,
    ratesCurrent,
    taxConstantsCurrent,
    requiresProfessionalReview: args.requiresProfessionalReview,
    informationalOnly: true,
  }
}

/** Split a record's fields into present/missing lists using display names. */
export function splitInputs(
  values: Record<string, unknown>,
  displayNames: Record<string, string>
): { present: string[]; missing: string[] } {
  const present: string[] = []
  const missing: string[] = []
  for (const [key, label] of Object.entries(displayNames)) {
    if (values[key] == null) missing.push(label)
    else present.push(label)
  }
  return { present, missing }
}
