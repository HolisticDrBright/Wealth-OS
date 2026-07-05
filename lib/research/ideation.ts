/**
 * Strategy-Scientist ideation templates (advisory / R&D layer).
 *
 * The LLM proposes HYPOTHESES; code computes and validates numbers. Every
 * template injects REAL data into the prompt and parses a strict schema back.
 *
 * HARD BOUNDARY: this module must never import broker, execution, sizing, or
 * strategy-runtime code. It cannot touch the burn-in. Enforced by an ESLint
 * no-restricted-imports rule (eslint.config.mjs) AND a guard test
 * (__tests__/research/import-boundary.spec.ts). Proposals are FILED, never
 * applied.
 */

// ─── LLM caller (injectable so tests never hit the network) ──────────────────

export type LlmComplete = (args: { system: string; prompt: string }) => Promise<string>

/** Default caller — lazy-imports the SDK so importing this module is free. */
export const defaultComplete: LlmComplete = async ({ system, prompt }) => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()
  const msg = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1500,
    system,
    messages: [{ role: 'user', content: prompt }],
  })
  return msg.content.find(b => b.type === 'text')?.text ?? '{}'
}

// ─── Performance-claim detector (the code guardrail, not a prompt request) ────

const PERF_PATTERNS: RegExp[] = [
  /\b(CAGR|sharpe|sortino|calmar|information ratio)\b/i,
  /\b(annuali[sz]ed|win[-\s]?rate|expectancy|max(imum)?\s+drawdown)\b/i,
  /\balpha\s+(of|=|:)/i,
  /\d+(\.\d+)?\s*(%|percent|bps|basis points)/i,
  /\b\d+(\.\d+)?\s*x\b/i,                 // "3x", "2.5x"
  /\$\s?\d/,                               // dollar figures
  /\breturns?\s+(of|=|:)?\s*\d/i,          // "return of 12"
]

/** True when the text asserts a numeric performance claim. */
export function containsPerformanceClaim(text: string): boolean {
  return PERF_PATTERNS.some(p => p.test(text))
}

// ─── zod-style validators (repo has no zod) ──────────────────────────────────

export interface RiskRewardProposal {
  change: string
  rationale: string
  expectedEffect: string
  /** Optional param-grid variant — numbers ALLOWED here (params, not claims). */
  paramGridPatch?: Record<string, unknown>
}

export interface RiskRewardOutput {
  proposals: RiskRewardProposal[]
}

export interface AlphaHypothesis {
  hypothesis: string
  mechanism: string
  testableSignal: string
}

export interface AlphaScanOutput {
  market: string
  hypotheses: AlphaHypothesis[]
}

function asObject(raw: string): Record<string, unknown> | null {
  try {
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return null
    const o = JSON.parse(m[0])
    return typeof o === 'object' && o !== null ? o as Record<string, unknown> : null
  } catch {
    return null
  }
}

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/**
 * Validate a risk/reward or optimization output. Prose fields (change,
 * rationale, expectedEffect) that assert a performance number are DROPPED;
 * paramGridPatch keeps its numbers (they are parameters, not claims).
 */
export function validateRiskReward(raw: string): { output: RiskRewardOutput; dropped: number } {
  const o = asObject(raw)
  const list = Array.isArray(o?.proposals) ? o!.proposals : []
  const proposals: RiskRewardProposal[] = []
  let dropped = 0
  for (const p of list) {
    if (typeof p !== 'object' || p === null) { dropped++; continue }
    const r = p as Record<string, unknown>
    if (!str(r.change) || !str(r.rationale) || !str(r.expectedEffect)) { dropped++; continue }
    if (containsPerformanceClaim(`${r.change} ${r.rationale} ${r.expectedEffect}`)) { dropped++; continue }
    const proposal: RiskRewardProposal = {
      change: r.change, rationale: r.rationale, expectedEffect: r.expectedEffect,
    }
    if (r.paramGridPatch && typeof r.paramGridPatch === 'object') {
      proposal.paramGridPatch = r.paramGridPatch as Record<string, unknown>
    }
    proposals.push(proposal)
  }
  return { output: { proposals }, dropped }
}

/**
 * Validate an alpha-scan output. Hypotheses only — ANY performance number in
 * ANY field rejects the ENTIRE output (returns null). No numeric claims are
 * permitted in market-structure hypotheses.
 */
export function validateAlphaScan(raw: string, market: string): AlphaScanOutput | null {
  const o = asObject(raw)
  const list = Array.isArray(o?.hypotheses) ? o!.hypotheses : []
  if (list.length === 0) return null
  const hypotheses: AlphaHypothesis[] = []
  for (const h of list) {
    if (typeof h !== 'object' || h === null) return null
    const r = h as Record<string, unknown>
    if (!str(r.hypothesis) || !str(r.mechanism) || !str(r.testableSignal)) return null
    if (containsPerformanceClaim(`${r.hypothesis} ${r.mechanism} ${r.testableSignal}`)) {
      return null   // a single numeric claim voids the whole scan
    }
    hypotheses.push({ hypothesis: r.hypothesis, mechanism: r.mechanism, testableSignal: r.testableSignal })
  }
  return { market, hypotheses }
}

// ─── Prompt builders (inject REAL data) ──────────────────────────────────────

const RR_SYSTEM =
  'You are a quantitative strategy scientist. Propose HYPOTHESES for improving a ' +
  'trading strategy under review. NEVER state performance numbers (no CAGR, Sharpe, ' +
  'percentages, dollar figures, or return claims) — those are computed by code, not you. ' +
  'Return ONLY JSON matching the requested schema.'

export function buildRiskRewardPrompt(scorecard: unknown): { system: string; prompt: string } {
  return {
    system: RR_SYSTEM,
    prompt:
      'Here is the strategy\'s real paper-trading scorecard:\n' +
      '```json\n' + JSON.stringify(scorecard, null, 2) + '\n```\n\n' +
      'Propose exactly 3 RISK REDUCTIONS and 2 RETURN IMPROVEMENTS that do not increase risk. ' +
      'Each proposal must be expressed qualitatively (mechanism + expected direction of effect), ' +
      'never with numbers. Where a proposal maps to a parameter change, include a paramGridPatch ' +
      'object of parameter → candidate value(s).\n\n' +
      'Return JSON: {"proposals":[{"change":string,"rationale":string,"expectedEffect":string,' +
      '"paramGridPatch":object?}]}',
  }
}

export function buildOptimizationPrompt(scorecard: unknown): { system: string; prompt: string } {
  return {
    system: RR_SYSTEM,
    prompt:
      'Strategy paper-trading scorecard:\n```json\n' + JSON.stringify(scorecard, null, 2) + '\n```\n\n' +
      'Propose parameter-optimization hypotheses. EVERY proposal MUST include a paramGridPatch ' +
      '(parameter → array of candidate values) so a walk-forward runner can test it later. ' +
      'No performance numbers in prose.\n\n' +
      'Return JSON: {"proposals":[{"change":string,"rationale":string,"expectedEffect":string,' +
      '"paramGridPatch":object}]}',
  }
}

const ALPHA_SYSTEM =
  'You are a market-structure researcher. Propose behavioral inefficiencies and ' +
  'market-structure gaps as TESTABLE HYPOTHESES. You are forbidden from stating any ' +
  'performance number (no CAGR, Sharpe, percentages, dollar amounts, return or win-rate ' +
  'claims). Output that contains any number-as-performance-claim will be discarded. ' +
  'Return ONLY JSON.'

export function buildAlphaScanPrompt(market: string): { system: string; prompt: string } {
  return {
    system: ALPHA_SYSTEM,
    prompt:
      `Market: ${market}\n\n` +
      'Propose 3–6 behavioral inefficiencies or market-structure gaps in this market. ' +
      'For each: the hypothesis, the mechanism (why the inefficiency could exist), and a ' +
      'testableSignal (what observable would confirm or deny it). Hypotheses ONLY — no ' +
      'numeric performance claims of any kind.\n\n' +
      'Return JSON: {"hypotheses":[{"hypothesis":string,"mechanism":string,"testableSignal":string}]}',
  }
}

// ─── Template runners (data in → validated proposals out) ─────────────────────

export async function riskRewardReview(
  scorecard: unknown,
  complete: LlmComplete = defaultComplete
): Promise<RiskRewardOutput> {
  const { system, prompt } = buildRiskRewardPrompt(scorecard)
  return validateRiskReward(await complete({ system, prompt })).output
}

export async function optimizationProposal(
  scorecard: unknown,
  complete: LlmComplete = defaultComplete
): Promise<RiskRewardOutput> {
  const { system, prompt } = buildOptimizationPrompt(scorecard)
  // Optimization proposals must carry a param grid — drop those that don't.
  const { output } = validateRiskReward(await complete({ system, prompt }))
  return { proposals: output.proposals.filter(p => p.paramGridPatch != null) }
}

export async function alphaScan(
  market: string,
  complete: LlmComplete = defaultComplete
): Promise<AlphaScanOutput | null> {
  const { system, prompt } = buildAlphaScanPrompt(market)
  return validateAlphaScan(await complete({ system, prompt }), market)
}

// ─── Filing rows (shape only — DB write happens in the server/cron layer) ────

export interface ProposalRow {
  kind: 'risk_reward' | 'optimization' | 'alpha_hypothesis'
  strategy_id: string | null
  market: string | null
  title: string
  body: Record<string, unknown>
  param_grid_patch: Record<string, unknown> | null
  /** Always 'stub' for research artifacts — they never trade. */
  maturity: 'stub'
  status: 'proposed'
  metadata: Record<string, unknown>
}

export function toRiskRewardRows(strategyId: string, out: RiskRewardOutput, kind: 'risk_reward' | 'optimization'): ProposalRow[] {
  return out.proposals.map(p => ({
    kind,
    strategy_id: strategyId,
    market: null,
    title: p.change.slice(0, 200),
    body: { rationale: p.rationale, expectedEffect: p.expectedEffect },
    param_grid_patch: p.paramGridPatch ?? null,
    maturity: 'stub',
    status: 'proposed',
    metadata: {},
  }))
}

/** Alpha hypotheses filed as research stub rows (maturity 'stub' — never trade). */
export function toAlphaRows(out: AlphaScanOutput): ProposalRow[] {
  return out.hypotheses.map(h => ({
    kind: 'alpha_hypothesis',
    strategy_id: null,
    market: out.market,
    title: h.hypothesis.slice(0, 200),
    body: { hypothesis: h.hypothesis, mechanism: h.mechanism, testableSignal: h.testableSignal },
    param_grid_patch: null,
    maturity: 'stub',
    status: 'proposed',
    metadata: { market: out.market, hypothesis: h.hypothesis },
  }))
}
