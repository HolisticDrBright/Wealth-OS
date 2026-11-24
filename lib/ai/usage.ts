/**
 * Model-call cost meter (roadmap #7). Every Anthropic call the app makes goes
 * through meteredCreate(), which records the real token usage and its dollar
 * cost (MODEL_PRICES_USD_PER_MTOK) in llm_usage_log — including FAILED calls
 * and safety declines (stop_reason 'refusal'), so an agent that errors or is
 * declined on every request shows up as cost with no vote.
 *
 * For the models in AI_FALLBACK_MODELS (Opus 5.5, Sonnet 5.5) the call goes
 * through the beta endpoint with Anthropic's server-side fallback
 * (`fallbacks: "default"`), so a safety decline is retried on another model
 * inside the same call. Cost is priced at the model that actually served it.
 *
 * Recording never changes the call: it is fire-and-forget, and a missing
 * table or service key only loses the log line.
 */

import type Anthropic from '@anthropic-ai/sdk'
import {
  MODEL_PRICES_USD_PER_MTOK, CACHE_WRITE_MULTIPLIER, CACHE_READ_MULTIPLIER,
  AI_FALLBACK_MODELS, MODEL_LONG_PROMPT_PRICES,
} from '@/lib/config/product-defaults'

export interface UsageMeta {
  /** Which subsystem: 'committee' | 'cio_synthesis' | 'mirofish' | 'kronos' | 'polymarket_agent' | 'ideation' | 'opportunity_screener' */
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

/** Beta header for server-side fallback. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** 'claude-haiku-4-5-20251001' → 'claude-haiku-4-5' (dated snapshots share their family's price). */
export function priceKey(model: string): string {
  return model.replace(/-\d{8}$/, '')
}

/** USD for one call; null when the model has no price on file. */
export function costOf(model: string, u: TokenUsage): number | null {
  const key = priceKey(model)
  const base = MODEL_PRICES_USD_PER_MTOK[key]
  if (!base) return null
  const prompt = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
  const long = MODEL_LONG_PROMPT_PRICES[key]
  const p = long && prompt > long.thresholdTokens ? long : base
  const input = u.input_tokens
    + (u.cache_creation_input_tokens ?? 0) * CACHE_WRITE_MULTIPLIER
    + (u.cache_read_input_tokens ?? 0) * CACHE_READ_MULTIPLIER
  return (input * p.input + u.output_tokens * p.output) / 1_000_000
}

/** True when this model's calls use server-side fallback. */
export function usesFallback(model: string): boolean {
  return AI_FALLBACK_MODELS.includes(priceKey(model))
}

async function record(row: Record<string, unknown>) {
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    let { error } = await createAdminClient().from('llm_usage_log').insert(row)
    // stop_reason arrived in migration 20260704t; keep logging without it until then.
    if (error && /stop_reason/.test(error.message ?? '')) {
      const { stop_reason: _drop, ...rest } = row
      void _drop
      ;({ error } = await createAdminClient().from('llm_usage_log').insert(rest))
    }
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
    const msg: Anthropic.Message = usesFallback(params.model)
      // The SDK types only the array form of `fallbacks`; "default" routes by
      // decline category so no fallback list has to be maintained here.
      ? await client.beta.messages.create({
          ...params, betas: [FALLBACK_BETA], fallbacks: 'default',
        } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming) as unknown as Anthropic.Message
      : await client.messages.create(params)
    // Never let metering change the call: a response without usage is
    // recorded with zero tokens and an unknown (null) cost.
    try {
      const u: TokenUsage | undefined = msg?.usage
      const servedBy = msg?.model ?? params.model
      void record({
        ...base, model: servedBy, ok: true, latency_ms: Date.now() - started,
        stop_reason: msg?.stop_reason ?? null,
        input_tokens: u?.input_tokens ?? 0, output_tokens: u?.output_tokens ?? 0,
        cache_write_tokens: u?.cache_creation_input_tokens ?? 0, cache_read_tokens: u?.cache_read_input_tokens ?? 0,
        cost_usd: u ? costOf(servedBy, u) : null,
      })
    } catch { /* metering is best-effort */ }
    return msg
  } catch (err) {
    void record({
      ...base, ok: false, latency_ms: Date.now() - started, stop_reason: null,
      input_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, cost_usd: 0,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    })
    throw err
  }
}

/** True when the model declined (safety classifier). Read before trusting content. */
export function wasDeclined(msg: Pick<Anthropic.Message, 'stop_reason'> | null | undefined): boolean {
  return msg?.stop_reason === 'refusal'
}
