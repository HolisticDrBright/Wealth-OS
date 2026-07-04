/**
 * Regime as portfolio ALLOCATOR (Remaining brief R4) — promotes the existing
 * per-strategy regime gate to the capital level.
 *
 * (a) classify() from simple observable inputs — yield curve, credit-spread
 *     proxy, realized vol vs its 1y median, breadth. No LLM.
 * (b) regimeConditionalWeights() — per-regime softmax once a strategy has
 *     ≥15 graded outcomes in that regime; otherwise global weights × the
 *     regime haircut the pipeline already applies.
 */

export type AllocatorRegime = 'risk_on' | 'risk_off' | 'crisis' | 'transition'

export interface RegimeInputs {
  /** 2s10s treasury spread, percentage points (negative = inverted). */
  curve2s10s: number | null
  /** HY OAS in bps (same input the pipeline regime gate uses). */
  hyOasBps: number | null
  /** Realized vol ÷ its trailing 1y median (1 = normal). */
  realizedVolRatio: number | null
  /** Fraction of sleeve assets above their 200dma [0,1]. */
  breadth: number | null
}

export function classifyAllocatorRegime(i: RegimeInputs): AllocatorRegime {
  let stress = 0
  let calm = 0
  if (i.hyOasBps != null) {
    if (i.hyOasBps >= 800) return 'crisis'
    if (i.hyOasBps >= 550) stress++
    else if (i.hyOasBps < 400) calm++
  }
  if (i.realizedVolRatio != null) {
    if (i.realizedVolRatio >= 2.5) return 'crisis'
    if (i.realizedVolRatio >= 1.5) stress++
    else if (i.realizedVolRatio < 1.1) calm++
  }
  if (i.curve2s10s != null) {
    if (i.curve2s10s < -0.25) stress++
    else if (i.curve2s10s > 0.5) calm++
  }
  if (i.breadth != null) {
    if (i.breadth < 0.3) stress++
    else if (i.breadth > 0.6) calm++
  }
  if (stress >= 2 && calm === 0) return 'risk_off'
  if (calm >= 2 && stress === 0) return 'risk_on'
  return 'transition'
}

// ─── Regime-conditional capital weights ───────────────────────────────────────

export interface RegimeOutcome {
  strategyKey: string
  regime: AllocatorRegime
  returnPct: number
}

export const MIN_REGIME_OUTCOMES = 15

export const REGIME_HAIRCUT: Record<AllocatorRegime, number> = {
  risk_on: 1.0,
  transition: 0.75,
  risk_off: 0.5,
  crisis: 0.0,   // the pipeline's CRISIS gate closes everything but hedges
}

/**
 * Regime capital multiplier for the LIVE sizing path (W-audit residue 3):
 * unknown/unclassified regimes fail OPEN to 1.0 — the haircut only applies
 * to a regime we actually measured.
 */
export function regimeCapitalMultiplier(regime: string | null | undefined): number {
  if (regime == null) return 1.0
  return REGIME_HAIRCUT[regime as AllocatorRegime] ?? 1.0
}

/**
 * Per-regime softmax over mean outcome when evidence exists; global weight ×
 * regime haircut otherwise. Output renormalized to sum to the (haircut)
 * total — never levers above the global allocation.
 */
export function regimeConditionalWeights(
  globalWeights: Record<string, number>,
  outcomes: RegimeOutcome[],
  regime: AllocatorRegime,
  temperature = 0.02
): Record<string, number> {
  const keys = Object.keys(globalWeights)
  const byKey = new Map<string, number[]>()
  for (const o of outcomes) {
    if (o.regime !== regime) continue
    if (!byKey.has(o.strategyKey)) byKey.set(o.strategyKey, [])
    byKey.get(o.strategyKey)!.push(o.returnPct)
  }

  const haircut = REGIME_HAIRCUT[regime]
  const evidenced = keys.filter(k => (byKey.get(k)?.length ?? 0) >= MIN_REGIME_OUTCOMES)

  const raw: Record<string, number> = {}
  if (evidenced.length >= 2) {
    // Softmax over regime-conditional mean returns for evidenced strategies;
    // unevidenced keep haircut global weights.
    const means = evidenced.map(k => {
      const rs = byKey.get(k)!
      return rs.reduce((s, r) => s + r, 0) / rs.length
    })
    const exps = means.map(m => Math.exp(m / temperature))
    const sumExp = exps.reduce((s, e) => s + e, 0)
    const evidencedBudget = evidenced.reduce((s, k) => s + globalWeights[k], 0)
    evidenced.forEach((k, i) => { raw[k] = evidencedBudget * (exps[i] / sumExp) })
    for (const k of keys) if (!(k in raw)) raw[k] = globalWeights[k]
  } else {
    for (const k of keys) raw[k] = globalWeights[k]
  }

  const out: Record<string, number> = {}
  for (const k of keys) out[k] = Math.round(raw[k] * haircut * 10_000) / 10_000
  return out
}
