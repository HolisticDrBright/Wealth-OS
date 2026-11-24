/**
 * Model-call cost meter (roadmap #7). Every Anthropic call the app makes goes
 * through meteredCreate(), which records the real token usage and its dollar
 * cost (MODEL_PRICES_USD_PER_MTOK) in llm_usage_log — including FAILED calls,
 * so an agent that errors on every request shows up as cost with no vote.
 *
 * Recording never changes the call: it is fire-and-forget, and a missing
 * table or service key only loses the log line.
 */

import type Anthropic from '@anthropic-ai/sdk'
import {
  MODEL_PRICES_USD_PER_MTOK, CACHE_WRITE_MULTIPLIER, CACHE_READ_MULTIPLIER,
} from '@/lib/config/product-defaults'

export interface UsageMeta {
  /** Which subsystem: 'committee' | 'cio_synthesis' | 'mirofish' | 'kronos' | 'polymarket_agent' | 'ideation' */
  caller: string
  /** Committee agent name, when the call is one agent's vote. */
  agentName?: string | null
  userId?: string | null
  /** One committee run (all its calls share it). */
  runId?: string | null
  symbol?: string | null
}

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

/** 'claude-haiku-4-5-20251001' → 'claude-haiku-4-5' (dated snapshots share their family's price). */
export function priceKey(model: string): string {
  return model.replace(/-\d{8}$/, '')
}

/** USD for one call; null when the model has no price on file. */
export function costOf(model: string, u: TokenUsage): number | null {
  const p = MODEL_PRICES_USD_PER_MTOK[priceKey(model)]
  if (!p) return null
  const input = u.input_tokens
    + (u.cache_creation_input_tokens ?? 0) * CACHE_WRITE_MULTIPLIER
    + (u.cache_read_input_tokens ?? 0) * CACHE_READ_MULTIPLIER
  return (input * p.input + u.output_tokens * p.output) / 1_000_000
}

async function record(row: Record<string, unknown>) {
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { error } = await createAdminClient().from('llm_usage_log').insert(row)
    if (error) console.warn('[llm-usage] log failed:', error.message)
  } catch { /* no service key in this context — the call itself is unaffected */ }
}

/** messages.create with the call's usage and cost recorded. Same result, same errors. */
export async function meteredCreate(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
  meta: UsageMeta,
): Promise<Anthropic.Message> {
  const started = Date.now()
  const base = {
    caller: meta.caller, agent_name: meta.agentName ?? null, user_id: meta.userId ?? null,
    run_id: meta.runId ?? null, symbol: meta.symbol ?? null, model: params.model,
  }
  try {
    const msg = await client.messages.create(params)
    // Never let metering change the call: a response without usage is
    // recorded with zero tokens and an unknown (null) cost.
    try {
      const u: TokenUsage | undefined = msg?.usage
      void record({
        ...base, ok: true, latency_ms: Date.now() - started,
        input_tokens: u?.input_tokens ?? 0, output_tokens: u?.output_tokens ?? 0,
        cache_write_tokens: u?.cache_creation_input_tokens ?? 0, cache_read_tokens: u?.cache_read_input_tokens ?? 0,
        cost_usd: u ? costOf(params.model, u) : null,
      })
    } catch { /* metering is best-effort */ }
    return msg
  } catch (err) {
    void record({
      ...base, ok: false, latency_ms: Date.now() - started,
      input_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, cost_usd: 0,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    })
    throw err
  }
}
