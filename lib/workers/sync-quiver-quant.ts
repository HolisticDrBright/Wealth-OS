/**
 * sync-quiver-quant — Congressional trades sync worker.
 *
 * Primary path:  Quiver Quant API (requires QUIVER_QUANT_API_KEY)
 * Fallback path: Camofox scrape of capitoltrades.com (requires camofox_scraping flag ON)
 *
 * Feature-flag logic:
 *   - quiver flag ON  → use Quiver Quant API (paid)
 *   - quiver flag OFF, camofox_scraping ON → scrape capitoltrades.com via Camofox
 *   - Both OFF        → skip, return empty
 *
 * Output: upserts into public.trader_trades (action='buy'/'sell', source='quiver_quant' or 'camofox_scrape')
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { FeatureFlagService } from '@/lib/feature-flags/FeatureFlagService'
import { getLiveCongressTrades } from '@/lib/market-data/quiver'
import { CamofoxClient } from '@/lib/integrations/camofox/CamofoxClient'
import { gateScrapedText } from '@/lib/workers/sync-news-sentiment'

const QUIVER_COST_CENTS = 2   // $0.02 per quiver API call

export interface SyncQuiverResult {
  tradesUpserted: number
  source: 'quiver_api' | 'camofox_scrape' | 'skipped'
  errors: string[]
}

export async function runSyncQuiverQuant(
  supabase: SupabaseClient,
  userId: string
): Promise<SyncQuiverResult> {
  const errors: string[] = []
  const svc = new FeatureFlagService(supabase)

  // ── Gate 1: Try Quiver Quant API ─────────────────────────────────────────
  const quiverGate = await svc.canSpend(userId, 'quiver', QUIVER_COST_CENTS)
  if (quiverGate.allowed && process.env.QUIVER_QUANT_API_KEY) {
    try {
      const trades = await getLiveCongressTrades()
      const upserted = await upsertTrades(supabase, trades, 'quiver_quant')
      svc.logUsage({ userId, featureKey: 'quiver', operation: 'live_congress_trades', costCents: QUIVER_COST_CENTS }).catch(() => {})
      return { tradesUpserted: upserted, source: 'quiver_api', errors }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`quiver_api error: ${msg}`)
      // fall through to Camofox
    }
  }

  // ── Gate 2: Camofox fallback — scrape capitoltrades.com ──────────────────
  const camofox = new CamofoxClient(supabase, userId)

  // Scrape the most-recent page of trades
  const scrape = await camofox.getPageText('https://www.capitoltrades.com/trades?per_page=96&page=1&chamber=all')
  if (scrape.skipped) {
    return { tradesUpserted: 0, source: 'skipped', errors: [...errors, scrape.reason] }
  }

  // Adversarial ingest gate — the scrape is UNTRUSTED web text.
  const gated = await gateScrapedText(supabase, 'capitoltrades.com', scrape.result.text)
  if (!gated.ok) {
    return { tradesUpserted: 0, source: 'skipped', errors: [...errors, `capitoltrades quarantined (${gated.flags.join(',')})`] }
  }

  const trades = parseCapitolTradesPage(gated.text)
  if (trades.length === 0) {
    errors.push('camofox_scrape: no trades parsed from capitoltrades.com')
    return { tradesUpserted: 0, source: 'camofox_scrape', errors }
  }

  const upserted = await upsertTrades(supabase, trades, 'camofox_scrape')
  return { tradesUpserted: upserted, source: 'camofox_scrape', errors }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface CongressRow {
  Ticker: string
  Representative: string
  Transaction: string
  Range: string
  TransactionDate: string
  ReportDate: string
  amount_usd?: number
}

async function upsertTrades(
  supabase: SupabaseClient,
  trades: CongressRow[],
  source: string
): Promise<number> {
  if (trades.length === 0) return 0

  // Find or create a synthetic "Congress" trader record
  const { data: trader } = await supabase
    .from('traders')
    .select('id')
    .eq('source', source === 'quiver_quant' ? 'quiver_quant' : 'manual')
    .eq('handle', 'congress_composite')
    .single()

  const traderId: string = trader?.id ?? (
    await supabase
      .from('traders')
      .upsert({
        name: 'Congressional Composite',
        handle: 'congress_composite',
        asset_class: 'stock',
        source: source === 'quiver_quant' ? 'quiver_quant' : 'manual',
        bio: 'Aggregated congressional trade disclosures',
      }, { onConflict: 'handle' })
      .select('id')
      .single()
      .then(r => r.data?.id ?? '')
  )

  if (!traderId) return 0

  const rows = trades
    .filter(t => t.Transaction === 'Purchase' || t.Transaction.startsWith('Sale'))
    .map(t => ({
      trader_id: traderId,
      asset_class: 'stock',
      symbol: t.Ticker,
      action: t.Transaction === 'Purchase' ? 'buy' : 'sell',
      notional_value: t.amount_usd ?? 0,
      trade_date: t.TransactionDate,
      source_trade_id: `${t.Representative}:${t.Ticker}:${t.TransactionDate}`,
      metadata: { representative: t.Representative, range: t.Range, report_date: t.ReportDate, source },
    }))

  const { error, data } = await supabase
    .from('trader_trades')
    .upsert(rows, { onConflict: 'source_trade_id' })
    .select('id')

  if (error) console.warn('[sync-quiver-quant] upsert error:', error.message)
  return data?.length ?? 0
}

/**
 * Parse the plain-text version of a capitoltrades.com page.
 * This is intentionally heuristic — scraping structure varies; we extract
 * ticker symbols, names, and transaction types from recognisable patterns.
 */
function parseCapitolTradesPage(text: string): CongressRow[] {
  const rows: CongressRow[] = []

  // Each trade block looks roughly like:
  //   "BUY AAPL $15,001 - $50,000 John Smith 2025-04-20 2025-04-22"
  // Pattern is fragile by nature — Camofox provides raw text, so we do
  // best-effort extraction and deduplicate on source_trade_id.
  const tradePattern =
    /\b([A-Z]{1,5})\b.*?\$([\d,]+)\s*[-–]\s*\$([\d,]+).*?([\w\s]+)\s+(\d{4}-\d{2}-\d{2})/g

  let match: RegExpExecArray | null
  while ((match = tradePattern.exec(text)) !== null) {
    const [, ticker, lo, hi, name, date] = match
    const low = parseInt(lo.replace(/,/g, ''), 10)
    const high = parseInt(hi.replace(/,/g, ''), 10)
    const isBuy = text.substring(Math.max(0, match.index - 20), match.index).toUpperCase().includes('BUY')

    rows.push({
      Ticker: ticker,
      Representative: name.trim(),
      Transaction: isBuy ? 'Purchase' : 'Sale (Full)',
      Range: `$${lo} - $${hi}`,
      TransactionDate: date,
      ReportDate: date,
      amount_usd: (low + high) / 2,
    })
  }

  return rows
}
