/**
 * CamofoxClient — HTTP client for the Camofox anti-detection browser service.
 *
 * Camofox (jo-inc) runs as a Docker container on port 9377 and exposes a REST
 * API for headless browser automation with C++ anti-detection patches.
 *
 * Used as a fallback when:
 *   - quiver_quant flag is OFF → scrape capitoltrades.com directly
 *   - Polymarket Dune dashboards need scraping
 *   - News sentiment scraping (Reddit / X)
 *
 * Every public method gates via FeatureFlagService.canSpend.
 * Cost: 5 cents per call (covers Docker compute overhead).
 *
 * Source: https://github.com/jo-inc/camofox-browser
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { FeatureFlagService } from '@/lib/feature-flags/FeatureFlagService'

const CAMOFOX_URL = process.env.CAMOFOX_URL ?? 'http://localhost:9377'
const FEATURE_KEY = 'camofox_scraping'
const CALL_COST_CENTS = 5
const TIMEOUT_MS = 45_000

export type CamofoxResponse<T> =
  | { result: T; skipped: false; reason?: never }
  | { result: null; skipped: true; reason: string }

export interface NavigateResult {
  url: string
  title: string
  status: number
  html: string
}

export interface PageTextResult {
  text: string
  wordCount: number
}

export interface ElementResult {
  text: string
  html: string
  found: boolean
}

export interface ScreenshotResult {
  base64: string
  width: number
  height: number
}

export interface MacroResult {
  success: boolean
  steps: { action: string; success: boolean; error?: string }[]
  finalUrl: string
}

export class CamofoxClient {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly userId: string
  ) {}

  /** Navigate to a URL and return the full HTML. */
  async navigate(url: string, waitMs = 2000): Promise<CamofoxResponse<NavigateResult>> {
    return this._call<NavigateResult>('navigate', { url, waitMs })
  }

  /** Navigate to a URL and return clean extracted text. */
  async getPageText(url: string): Promise<CamofoxResponse<PageTextResult>> {
    const nav = await this._call<NavigateResult>('navigate', { url })
    if (nav.skipped) return nav
    const text = stripHtml(nav.result.html)
    return { result: { text, wordCount: text.split(/\s+/).length }, skipped: false }
  }

  /** Extract text from a specific CSS selector. */
  async getElementText(url: string, selector: string): Promise<CamofoxResponse<ElementResult>> {
    return this._call<ElementResult>('element', { url, selector })
  }

  /** Fill a form and submit it. */
  async fillForm(url: string, fields: Record<string, string>, submitSelector: string): Promise<CamofoxResponse<NavigateResult>> {
    return this._call<NavigateResult>('form', { url, fields, submitSelector })
  }

  /** Take a screenshot of a URL. */
  async screenshot(url: string, fullPage = false): Promise<CamofoxResponse<ScreenshotResult>> {
    return this._call<ScreenshotResult>('screenshot', { url, fullPage })
  }

  /** Run a multi-step macro (sequence of actions). */
  async runMacro(steps: { action: string; params: Record<string, unknown> }[]): Promise<CamofoxResponse<MacroResult>> {
    return this._call<MacroResult>('macro', { steps })
  }

  /** Fetch a YouTube video transcript. */
  async getYoutubeTranscript(videoUrl: string): Promise<CamofoxResponse<{ transcript: string; duration_seconds: number }>> {
    return this._call('youtube_transcript', { url: videoUrl })
  }

  /** Close the browser session (free up Docker resources). */
  async dispose(): Promise<void> {
    try {
      await fetch(`${CAMOFOX_URL}/session/close`, {
        method: 'POST',
        signal: AbortSignal.timeout(5_000),
      })
    } catch { /* best-effort */ }
  }

  /** Health check — does not consume budget. */
  static async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now()
    try {
      const res = await fetch(`${CAMOFOX_URL}/health`, {
        signal: AbortSignal.timeout(5_000),
      })
      return { ok: res.ok, latencyMs: Date.now() - start }
    } catch {
      return { ok: false, latencyMs: Date.now() - start }
    }
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private async _call<T>(
    endpoint: string,
    body: Record<string, unknown>
  ): Promise<CamofoxResponse<T>> {
    const svc = new FeatureFlagService(this.supabase)
    const gate = await svc.canSpend(this.userId, FEATURE_KEY, CALL_COST_CENTS)

    if (!gate.allowed) {
      return {
        result: null,
        skipped: true,
        reason: gate.reason === 'disabled'
          ? 'camofox_scraping feature disabled'
          : `camofox_scraping budget exhausted (${gate.reason})`,
      }
    }

    try {
      const res = await fetch(`${CAMOFOX_URL}/api/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      if (!res.ok) {
        return { result: null, skipped: true, reason: `camofox HTTP ${res.status}` }
      }

      const data = await res.json() as T

      svc.logUsage({
        userId: this.userId,
        featureKey: FEATURE_KEY,
        operation: endpoint,
        costCents: CALL_COST_CENTS,
        metadata: { endpoint, url: (body.url as string | undefined) ?? null },
      }).catch(() => { /* fire-and-forget */ })

      return { result: data, skipped: false }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[CamofoxClient] endpoint=${endpoint} error: ${msg}`)
      return { result: null, skipped: true, reason: `camofox unreachable: ${msg}` }
    }
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function createCamofoxClient(supabase: SupabaseClient, userId: string): CamofoxClient {
  return new CamofoxClient(supabase, userId)
}
