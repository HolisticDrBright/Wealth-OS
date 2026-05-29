'use server'

/**
 * Agent Trust / Calibration data assembly for the /learning dashboard.
 *
 * Surfaces, per AI layer (MiroFish, Kronos, Red Team, CIO Decision Engine):
 *   - whether it currently runs and whether its vote actually drives execution
 *     (active vs "shadow" — computes but does not change the trade)
 *   - the learned vote weight it carries, when one maps to it
 *   - best-effort calibration (recent accuracy / Brier / graded count)
 *
 * HONESTY CONTRACT: dev tables are typically empty and per-agent outcome
 * attribution is not persisted (outcome_log links to a decision's *strategy*,
 * not to an individual agent). So per-agent accuracy/Brier are almost always
 * null here — that is correct. Every query is wrapped so a failure degrades to
 * null/0 rather than throwing. Nothing is fabricated.
 */

import { createClient } from '@/lib/supabase/server'
import { loadWeightsForUser } from '@/lib/learning/weights'

export interface AgentTrust {
  key: string
  name: string
  description?: string
  status: 'active' | 'shadow' | 'disabled'
  affectsDecisions: boolean
  voteWeight: number | null
  accuracy: number | null
  brier: number | null
  gradedCount: number | null
  lastRecalibrated: string | null
  note?: string
}

export interface CalibrationContext {
  totalGraded: number
  pendingGrade: number
}

type Status = AgentTrust['status']

/**
 * Derive run status from environment/config.
 *  - active : layer runs AND its vote can change the executed trade
 *  - shadow : layer computes but does not drive execution (no hard env, or
 *             only a synthetic fallback is available)
 *  - disabled: layer cannot run at all
 */
function deriveStatus(): {
  mirofish: { status: Status; note: string }
  kronos: { status: Status; note: string }
  redTeam: { status: Status; note: string }
  cio: { status: Status; note: string }
} {
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY
  const hasMiroFish = !!process.env.MIROFISH_BASE_URL
  const hasKronos = !!process.env.KRONOS_BASE_URL

  // CIO orchestrates the final decision via Claude. Active only if it can call
  // a model; otherwise it cannot orchestrate, so it shadows.
  const cioStatus: Status = hasAnthropic ? 'active' : 'shadow'

  // MiroFish: a real service (MIROFISH_BASE_URL) or a Claude-backed fallback
  // (ANTHROPIC_API_KEY) lets its bear/bull gate change the trade → active.
  // With neither it cannot produce a verdict → shadow.
  const mirofishActive = hasMiroFish || hasAnthropic
  const mirofishStatus: Status = mirofishActive ? 'active' : 'shadow'

  // Kronos: drives the confluence gate when its forecasting service is
  // configured. Without KRONOS_BASE_URL it falls back to a synthetic
  // distribution, which we treat as shadow (computed, not authoritative).
  const kronosStatus: Status = hasKronos ? 'active' : 'shadow'

  // Red Team is a deterministic composite-score reviewer (pure math, no model
  // or external service) and always gates the decision → active.
  const redTeamStatus: Status = 'active'

  return {
    mirofish: {
      status: mirofishStatus,
      note: hasMiroFish
        ? 'Live MiroFish service configured; bear scenarios reduce position size.'
        : hasAnthropic
          ? 'Claude-backed simulation fallback (no MIROFISH_BASE_URL); still gates the trade.'
          : 'No MIROFISH_BASE_URL or model key — computes nothing it can act on.',
    },
    kronos: {
      status: kronosStatus,
      note: hasKronos
        ? 'Self-hosted Kronos forecast service configured; contradictions can block longs.'
        : 'No KRONOS_BASE_URL — synthetic distribution only, treated as shadow (not authoritative).',
    },
    redTeam: {
      status: redTeamStatus,
      note: 'Deterministic adversarial review; low composite scores reduce position size.',
    },
    cio: {
      status: cioStatus,
      note: hasAnthropic
        ? 'Final orchestrator over all agent verdicts; emits the executed action.'
        : 'No ANTHROPIC_API_KEY — cannot orchestrate, so it shadows.',
    },
  }
}

/** Total graded outcomes + pending-grade decisions for the current user. */
export async function getCalibrationContext(): Promise<CalibrationContext> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { totalGraded: 0, pendingGrade: 0 }

    const [{ count: graded }, { count: pending }] = await Promise.all([
      supabase
        .from('outcome_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      supabase
        .from('decision_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('outcome_graded', false),
    ])
    return { totalGraded: graded ?? 0, pendingGrade: pending ?? 0 }
  } catch {
    return { totalGraded: 0, pendingGrade: 0 }
  }
}

/**
 * Best-effort per-strategy calibration from graded outcomes, used to populate
 * agents whose key maps to a logged strategy (mirofish, kronos). Returns a map
 * of strategy → { accuracy, brier, gradedCount, lastRecalibrated } or {} on any
 * failure / empty tables.
 */
async function loadStrategyCalibration(
  userId: string,
): Promise<Record<string, { accuracy: number | null; brier: number | null; gradedCount: number; lastRecalibrated: string | null }>> {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('outcome_log')
      .select('actual_direction, brier_score, resolved_at, decision:decision_log!inner(strategy, predicted_direction)')
      .eq('user_id', userId)
      .order('resolved_at', { ascending: false })
      .limit(1000)

    type DecisionJoin = { strategy: string; predicted_direction: number | null }
    const rows = (data ?? []) as unknown as Array<{
      actual_direction: number | null
      brier_score: number | null
      resolved_at: string | null
      // Supabase types a joined to-one relation as an array; normalize below.
      decision: DecisionJoin | DecisionJoin[] | null
    }>

    const acc: Record<string, { hits: number; n: number; brierSum: number; brierN: number; latest: string | null }> = {}
    for (const r of rows) {
      const decision = Array.isArray(r.decision) ? r.decision[0] : r.decision
      const strat = decision?.strategy
      if (!strat) continue
      const bucket = (acc[strat] ??= { hits: 0, n: 0, brierSum: 0, brierN: 0, latest: null })
      bucket.n += 1
      if (
        decision?.predicted_direction != null &&
        r.actual_direction != null &&
        decision.predicted_direction === r.actual_direction
      ) {
        bucket.hits += 1
      }
      if (typeof r.brier_score === 'number') {
        bucket.brierSum += r.brier_score
        bucket.brierN += 1
      }
      if (r.resolved_at && (!bucket.latest || r.resolved_at > bucket.latest)) {
        bucket.latest = r.resolved_at
      }
    }

    const out: Record<string, { accuracy: number | null; brier: number | null; gradedCount: number; lastRecalibrated: string | null }> = {}
    for (const [strat, b] of Object.entries(acc)) {
      out[strat] = {
        accuracy: b.n > 0 ? b.hits / b.n : null,
        brier: b.brierN > 0 ? b.brierSum / b.brierN : null,
        gradedCount: b.n,
        lastRecalibrated: b.latest,
      }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Assemble the Agent Trust board. Weather/Polymarket agents are intentionally
 * omitted: no separately graded data exists for them in this codebase, so
 * representing them would be fabrication.
 */
export async function getAgentTrust(): Promise<AgentTrust[]> {
  const derived = deriveStatus()

  let weights: Record<string, number> = {}
  let calibration: Record<string, { accuracy: number | null; brier: number | null; gradedCount: number; lastRecalibrated: string | null }> = {}

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const [w, c] = await Promise.all([
        loadWeightsForUser(user.id).catch(() => ({} as Record<string, number>)),
        loadStrategyCalibration(user.id),
      ])
      weights = w
      calibration = c
    }
  } catch {
    weights = {}
    calibration = {}
  }

  // Map each agent to a learned-weight key + a calibration strategy key when one
  // exists. Red Team and the CIO orchestrator have no weight key (they are
  // gates/orchestration, not weighted signals) → voteWeight stays null.
  const cal = (key: string | null) => (key ? calibration[key] : undefined)

  const agents: AgentTrust[] = [
    {
      key: 'mirofish',
      name: 'MiroFish',
      description: 'Multi-agent market simulation. Runs bull/bear scenarios; a bear consensus opposing a long reduces position size.',
      status: derived.mirofish.status,
      affectsDecisions: derived.mirofish.status === 'active',
      voteWeight: weights.mirofish ?? null,
      accuracy: cal('mirofish')?.accuracy ?? null,
      brier: cal('mirofish')?.brier ?? null,
      gradedCount: cal('mirofish')?.gradedCount ?? null,
      lastRecalibrated: cal('mirofish')?.lastRecalibrated ?? null,
      note: derived.mirofish.note,
    },
    {
      key: 'kronos',
      name: 'Kronos',
      description: 'Probabilistic price-path predictor. A forecast that contradicts a long can block the trade (confluence gate).',
      status: derived.kronos.status,
      affectsDecisions: derived.kronos.status === 'active',
      voteWeight: weights.kronos ?? null,
      accuracy: cal('kronos')?.accuracy ?? null,
      brier: cal('kronos')?.brier ?? null,
      gradedCount: cal('kronos')?.gradedCount ?? null,
      lastRecalibrated: cal('kronos')?.lastRecalibrated ?? null,
      note: derived.kronos.note,
    },
    {
      key: 'red_team',
      name: 'Red Team',
      description: 'Adversarial reviewer. Scores the thesis for weakness; a low composite score reduces position size.',
      status: derived.redTeam.status,
      affectsDecisions: derived.redTeam.status === 'active',
      voteWeight: null,
      accuracy: null,
      brier: null,
      gradedCount: null,
      lastRecalibrated: null,
      note: derived.redTeam.note,
    },
    {
      key: 'cio',
      name: 'CIO Decision Engine',
      description: 'Final orchestrator. Combines every agent verdict into the executed action (approve / reduce / block).',
      status: derived.cio.status,
      affectsDecisions: derived.cio.status === 'active',
      voteWeight: null,
      accuracy: null,
      brier: null,
      gradedCount: null,
      lastRecalibrated: null,
      note: derived.cio.note,
    },
  ]

  return agents
}
