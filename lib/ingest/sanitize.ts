/**
 * Typed extraction sandbox (Gap brief B1) — the ONLY gate through which
 * external text (news, scraped pages, social posts) may reach any agent.
 *
 * Pipeline: pre-filter (hidden text, zero-width chars, injection patterns —
 * flagged items go to ingest_quarantine) → typed extraction → zod-style
 * validation. Schema failure or refusal = dropped and logged, never passed raw.
 * Downstream agents receive ONLY TypedEvent objects.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sanitizeScrapedContent } from '@/lib/security/adversarial-guard'

export const EVENT_TYPES = [
  'regulatory', 'earnings', 'macro', 'exchange_incident', 'partnership',
  'listing', 'hack', 'funding', 'legal', 'other',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export interface TypedEvent {
  event_type: EventType
  entities: string[]
  direction: -1 | 0 | 1
  magnitude: number   // 0..1
  source_id: string
  published_at: string
  quote: string       // ≤ 280 chars, sanitized
}

const MAX_QUOTE = 280

/** Strip hidden/invisible payload carriers before anything else. */
export function preFilter(raw: string): { text: string; flags: string[] } {
  const flags: string[] = []
  let text = raw
  // Zero-width + bidi control characters (classic hidden-injection carriers)
  if (/[​-‏‪-‮⁠-⁤﻿]/.test(text)) {
    flags.push('zero_width_or_bidi_chars')
    text = text.replace(/[​-‏‪-‮⁠-⁤﻿]/g, '')
  }
  // HTML comments and hidden elements
  if (/<!--[\s\S]*?-->/.test(text)) {
    flags.push('html_comment')
    text = text.replace(/<!--[\s\S]*?-->/g, ' ')
  }
  if (/style\s*=\s*["'][^"']*(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)/i.test(text)) {
    flags.push('hidden_html')
    text = text.replace(/<[^>]+style\s*=\s*["'][^"']*(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, ' ')
  }
  // Imperative/injection patterns (delegates to the shared guard)
  const guarded = sanitizeScrapedContent(text)
  return { text: guarded.text, flags: [...flags, ...guarded.flags] }
}

/** Validate a candidate TypedEvent — the zod-style schema gate. */
export function validateTypedEvent(x: unknown): TypedEvent | null {
  if (typeof x !== 'object' || x === null) return null
  const o = x as Record<string, unknown>
  if (!EVENT_TYPES.includes(o.event_type as EventType)) return null
  if (!Array.isArray(o.entities) || !o.entities.every(e => typeof e === 'string')) return null
  if (o.direction !== -1 && o.direction !== 0 && o.direction !== 1) return null
  const magnitude = Number(o.magnitude)
  if (!Number.isFinite(magnitude) || magnitude < 0 || magnitude > 1) return null
  if (typeof o.source_id !== 'string' || !o.source_id) return null
  if (typeof o.published_at !== 'string' || isNaN(Date.parse(o.published_at))) return null
  if (typeof o.quote !== 'string') return null

  // The quote itself must be clean — an injected quote is an injected prompt.
  const cleaned = preFilter(o.quote)
  if (cleaned.flags.length > 0) return null

  return {
    event_type: o.event_type as EventType,
    entities: (o.entities as string[]).slice(0, 10),
    direction: o.direction,
    magnitude,
    source_id: o.source_id,
    published_at: o.published_at,
    quote: cleaned.text.slice(0, MAX_QUOTE),
  }
}

/**
 * Full ingest gate. Flagged content is quarantined (when a client is given)
 * and NEVER returned raw. The extractor callback runs with the pre-filtered
 * text only — callers must give it no tool access.
 */
export async function ingestExternalText(args: {
  raw: string
  sourceId: string
  publishedAt: string
  /** Sandboxed extractor: pre-filtered text in, candidate event out. */
  extract: (cleanText: string) => Promise<unknown>
  supabase?: SupabaseClient
}): Promise<{ event: TypedEvent | null; quarantined: boolean; flags: string[] }> {
  const { text, flags } = preFilter(args.raw)

  if (flags.length > 0 && args.supabase) {
    try {
      await args.supabase.from('ingest_quarantine').insert({
        source_id: args.sourceId,
        raw_content: args.raw.slice(0, 10_000),
        flags,
        reason: 'pre-filter flagged content',
      })
    } catch { /* quarantine best-effort; the DROP below is the guarantee */ }
  }
  // Injection-flagged content never proceeds to extraction at all.
  if (flags.some(f => f !== 'html_comment')) {
    return { event: null, quarantined: true, flags }
  }

  let candidate: unknown
  try {
    candidate = await args.extract(text)
  } catch {
    return { event: null, quarantined: false, flags: [...flags, 'extractor_refused'] }
  }
  const event = validateTypedEvent(
    typeof candidate === 'object' && candidate !== null
      ? { source_id: args.sourceId, published_at: args.publishedAt, ...candidate }
      : candidate
  )
  return { event, quarantined: false, flags }
}

// ─── Signal assembly gate (B2 + B3 composed) ──────────────────────────────────

export interface AssemblyEvent {
  source_id: string
  direction: -1 | 0 | 1
  /** From source_scores.admitted — earned on evidence, recertified rolling. */
  sourceAdmitted: boolean
}

/**
 * May these typed events INCREASE exposure? Requires ≥2 events from distinct
 * ADMITTED sources agreeing on direction. Anything less may only reduce
 * exposure or do nothing — fake headlines die here even when they read clean.
 */
export function canIncreaseRisk(events: AssemblyEvent[]): { allowed: boolean; reason?: string } {
  const admitted = events.filter(e => e.sourceAdmitted && e.direction !== 0)
  const sources = new Set(admitted.map(e => e.source_id.toLowerCase().trim()))
  if (sources.size < 2) {
    return {
      allowed: false,
      reason: `${sources.size} admitted source(s) — risk-increasing signals need ≥2 independent admitted sources`,
    }
  }
  const directions = new Set(admitted.map(e => e.direction))
  if (directions.size > 1) {
    return { allowed: false, reason: 'admitted sources disagree on direction' }
  }
  return { allowed: true }
}
