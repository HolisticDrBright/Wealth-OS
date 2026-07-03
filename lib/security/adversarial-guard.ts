/**
 * Adversarial-input defense (Gap Analysis #2). An AI system that reads
 * scraped web content and then trades is an attack surface: crafted headlines
 * and embedded prompt injections can move the committee. Structural rules:
 *
 *  1. Scraped content is DATA, never instructions — imperative/injection
 *     content is stripped and flagged; only typed fields survive extraction.
 *  2. Two-source rule: a signal may INCREASE risk only with ≥2 independent
 *     sources; single-source news can only reduce exposure.
 */

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any |your )?(previous|prior|above) (instructions|prompts|rules)/i,
  /disregard (your|the|all) (instructions|guidelines|system prompt)/i,
  /you (are|is) now (a|an|in) /i,
  /system prompt/i,
  /\bDAN\b|jailbreak/i,
  /(execute|run|call) (the )?(tool|function|command)/i,
  /(buy|sell|short|long) (immediately|now|max|all[- ]in)/i,
  /act as (if|though|a|an)/i,
  /<\s*(script|iframe|img[^>]*onerror)/i,
  /\{\{.*\}\}|\$\{.*\}/,
]

export interface SanitizedContent {
  /** Cleaned text with flagged spans removed. */
  text: string
  /** True when injection/imperative content was detected and stripped. */
  flagged: boolean
  flags: string[]
}

/** Strip injection patterns from scraped content; never let them reach an LLM prompt as instructions. */
export function sanitizeScrapedContent(raw: string): SanitizedContent {
  const flags: string[] = []
  let text = raw
  for (const pattern of INJECTION_PATTERNS) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
    if (global.test(text)) {
      flags.push(pattern.source.slice(0, 40))
      text = text.replace(global, '[stripped]')
    }
  }
  return { text, flagged: flags.length > 0, flags }
}

export interface ExtractedEvent {
  event: string
  source: string
  confidence: number
}

/** Typed extraction gate: only well-formed {event, source, confidence} survive. */
export function validateExtractedEvent(x: unknown): ExtractedEvent | null {
  if (typeof x !== 'object' || x === null) return null
  const o = x as Record<string, unknown>
  if (typeof o.event !== 'string' || typeof o.source !== 'string') return null
  const confidence = Number(o.confidence)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null
  const cleaned = sanitizeScrapedContent(o.event)
  if (cleaned.flagged) return null  // injected "events" never become signals
  return { event: cleaned.text, source: o.source, confidence }
}

export interface SignalSourceCheck {
  allowed: boolean
  reason?: string
}

/**
 * Two-source rule: risk-INCREASING signals need ≥2 independent sources.
 * Single-source signals may only REDUCE exposure.
 */
export function twoSourceRule(args: {
  increasesRisk: boolean
  independentSources: string[]
}): SignalSourceCheck {
  const unique = new Set(args.independentSources.map(s => s.toLowerCase().trim())).size
  if (!args.increasesRisk) return { allowed: true }
  if (unique >= 2) return { allowed: true }
  return {
    allowed: false,
    reason: `risk-increasing signal has ${unique} source(s) — needs ≥2 independent; single-source news may only reduce exposure`,
  }
}
