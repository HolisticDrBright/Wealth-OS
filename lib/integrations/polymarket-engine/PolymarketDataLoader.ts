/**
 * PolymarketDataLoader — reads warproxxx/poly_data snapshot files for backtesting.
 *
 * Source: https://github.com/warproxxx/poly_data
 * Submodule: data/external/poly_data  (see data/external/poly_data/.gitkeep for setup)
 *
 * Expected on-disk layout (after `python download_snapshot.py`):
 *   data/external/poly_data/
 *     markets/markets.csv            — one row per market
 *     order_events/{conditionId}.csv — LOB update stream
 *     trades/{conditionId}.csv       — fill stream
 *
 * CSV schemas (poly_data v2):
 *   markets.csv:
 *     condition_id, question, description, end_date_iso, market_slug,
 *     outcome_yes, outcome_no, yes_token_id, no_token_id, status,
 *     created_at, volume_usd
 *
 *   order_events/{id}.csv:
 *     timestamp_ms, side (yes|no), price, size, event_type (place|cancel|match)
 *
 *   trades/{id}.csv:
 *     timestamp_ms, price, size, maker_side (yes|no), taker_side (yes|no)
 */

import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'

// ─── Row types ────────────────────────────────────────────────────────────────

export interface MarketRow {
  conditionId: string
  question: string
  description: string
  endDateIso: string
  marketSlug: string
  yesTokenId: string
  noTokenId: string
  status: 'active' | 'resolved' | 'cancelled'
  createdAt: string
  volumeUsd: number
}

export interface OrderEventRow {
  conditionId: string
  timestampMs: number
  side: 'yes' | 'no'
  price: number
  size: number
  eventType: 'place' | 'cancel' | 'match'
}

export interface TradeRow {
  conditionId: string
  timestampMs: number
  price: number
  size: number
  makerSide: 'yes' | 'no'
  takerSide: 'yes' | 'no'
}

export interface OrderBookSnapshot {
  ts: number
  bids: { price: number; size: number }[]   // bids on YES (buying YES = bullish)
  asks: { price: number; size: number }[]   // asks on YES (selling YES = bearish)
  fills: TradeRow[]
}

// ─── Keyword patterns for crypto binary markets ───────────────────────────────

const CRYPTO_PATTERNS: Record<string, RegExp> = {
  BTC:  /\b(btc|bitcoin)\b/i,
  ETH:  /\b(eth|ethereum)\b/i,
  SOL:  /\b(sol|solana)\b/i,
  XRP:  /\b(xrp|ripple)\b/i,
  DOGE: /\b(doge|dogecoin)\b/i,
}

// Matches "above $X at Y:Z" or "will BTC be over $X" price-level binary markets
const BINARY_PRICE_PATTERN = /\$([\d,]+)|\babove\b|\bbelow\b|\bover\b|\bunder\b/i
// Window patterns
const WINDOW_5MIN  = /\b5.?min(ute)?s?\b/i
const WINDOW_15MIN = /\b15.?min(ute)?s?\b/i

// ─── Loader ───────────────────────────────────────────────────────────────────

export class PolymarketDataLoader {
  private readonly marketsFile: string
  private readonly orderEventsDir: string
  private readonly tradesDir: string

  constructor(snapshotPath: string) {
    this.marketsFile    = path.join(snapshotPath, 'markets', 'markets.csv')
    this.orderEventsDir = path.join(snapshotPath, 'order_events')
    this.tradesDir      = path.join(snapshotPath, 'trades')
  }

  /** Stream all market rows from markets.csv. */
  async *loadMarkets(): AsyncIterable<MarketRow> {
    if (!fs.existsSync(this.marketsFile)) return

    for await (const row of this._readCsv(this.marketsFile)) {
      yield {
        conditionId:  row['condition_id'] ?? row['conditionId'] ?? '',
        question:     row['question'] ?? '',
        description:  row['description'] ?? '',
        endDateIso:   row['end_date_iso'] ?? row['end_date'] ?? '',
        marketSlug:   row['market_slug'] ?? '',
        yesTokenId:   row['yes_token_id'] ?? '',
        noTokenId:    row['no_token_id'] ?? '',
        status:       (row['status'] ?? 'active') as MarketRow['status'],
        createdAt:    row['created_at'] ?? '',
        volumeUsd:    parseFloat(row['volume_usd'] ?? '0') || 0,
      }
    }
  }

  /** Stream order events for one market (or all markets if marketId omitted). */
  async *loadOrderEvents(marketId?: string): AsyncIterable<OrderEventRow> {
    const files = marketId
      ? [`${marketId}.csv`]
      : this._listCsvFiles(this.orderEventsDir)

    for (const file of files) {
      const conditionId = path.basename(file, '.csv')
      const fullPath = path.join(this.orderEventsDir, file)
      if (!fs.existsSync(fullPath)) continue

      for await (const row of this._readCsv(fullPath)) {
        yield {
          conditionId,
          timestampMs: parseInt(row['timestamp_ms'] ?? row['ts'] ?? '0', 10),
          side:        (row['side'] ?? 'yes') as 'yes' | 'no',
          price:       parseFloat(row['price'] ?? '0'),
          size:        parseFloat(row['size'] ?? '0'),
          eventType:   (row['event_type'] ?? 'place') as OrderEventRow['eventType'],
        }
      }
    }
  }

  /** Stream trades for one market (or all), optionally filtered by time range. */
  async *loadTrades(
    marketId?: string,
    fromTs?: Date,
    toTs?: Date
  ): AsyncIterable<TradeRow> {
    const files = marketId
      ? [`${marketId}.csv`]
      : this._listCsvFiles(this.tradesDir)

    const fromMs = fromTs ? fromTs.getTime() : 0
    const toMs   = toTs   ? toTs.getTime()   : Infinity

    for (const file of files) {
      const conditionId = path.basename(file, '.csv')
      const fullPath = path.join(this.tradesDir, file)
      if (!fs.existsSync(fullPath)) continue

      for await (const row of this._readCsv(fullPath)) {
        const ts = parseInt(row['timestamp_ms'] ?? row['ts'] ?? '0', 10)
        if (ts < fromMs || ts > toMs) continue

        yield {
          conditionId,
          timestampMs: ts,
          price:       parseFloat(row['price'] ?? '0'),
          size:        parseFloat(row['size'] ?? '0'),
          makerSide:   (row['maker_side'] ?? 'yes') as 'yes' | 'no',
          takerSide:   (row['taker_side'] ?? 'no')  as 'yes' | 'no',
        }
      }
    }
  }

  /**
   * Filter markets to crypto-binary 5-min or 15-min price markets.
   * Uses heuristic keyword matching on question text.
   */
  async *getCryptoBinary5MinMarkets(
    symbol: 'BTC' | 'ETH' | 'SOL' | 'XRP' | 'DOGE',
    windowMin: 5 | 15
  ): AsyncIterable<MarketRow> {
    const symPat = CRYPTO_PATTERNS[symbol]
    const winPat = windowMin === 5 ? WINDOW_5MIN : WINDOW_15MIN

    for await (const mkt of this.loadMarkets()) {
      const text = `${mkt.question} ${mkt.description}`
      if (symPat.test(text) && winPat.test(text) && BINARY_PRICE_PATTERN.test(text)) {
        yield mkt
      }
    }
  }

  /**
   * Replay a single market: emit time-ordered order-book snapshots.
   * Each snapshot contains the current LOB state + any fills in that interval.
   */
  async *replayMarket(marketId: string): AsyncIterable<OrderBookSnapshot> {
    // Collect all events and trades, then merge by timestamp
    const events: OrderEventRow[] = []
    const trades: TradeRow[] = []

    for await (const e of this.loadOrderEvents(marketId)) events.push(e)
    for await (const t of this.loadTrades(marketId))      trades.push(t)

    events.sort((a, b) => a.timestampMs - b.timestampMs)
    trades.sort((a, b) => a.timestampMs - b.timestampMs)

    if (events.length === 0) return

    // Group into 30-second buckets
    const BUCKET_MS = 30_000
    const startMs = events[0].timestampMs
    const endMs   = events[events.length - 1].timestampMs
    const bids = new Map<number, number>()  // price → size
    const asks = new Map<number, number>()

    let tradeIdx = 0

    for (let ts = startMs; ts <= endMs; ts += BUCKET_MS) {
      const bucketEnd = ts + BUCKET_MS

      // Apply order events in this bucket
      for (const ev of events.filter(e => e.timestampMs >= ts && e.timestampMs < bucketEnd)) {
        if (ev.eventType === 'cancel') {
          if (ev.side === 'yes') bids.delete(ev.price)
          else                   asks.delete(ev.price)
        } else {
          if (ev.side === 'yes') bids.set(ev.price, (bids.get(ev.price) ?? 0) + ev.size)
          else                   asks.set(ev.price, (asks.get(ev.price) ?? 0) + ev.size)
        }
      }

      // Collect fills in this bucket
      const bucketFills: TradeRow[] = []
      while (tradeIdx < trades.length && trades[tradeIdx].timestampMs < bucketEnd) {
        bucketFills.push(trades[tradeIdx++])
      }

      // Emit snapshot
      yield {
        ts: bucketEnd,
        bids: [...bids.entries()]
          .sort((a, b) => b[0] - a[0])   // descending price
          .map(([price, size]) => ({ price, size })),
        asks: [...asks.entries()]
          .sort((a, b) => a[0] - b[0])   // ascending price
          .map(([price, size]) => ({ price, size })),
        fills: bucketFills,
      }
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private _listCsvFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter(f => f.endsWith('.csv'))
  }

  private async *_readCsv(filePath: string): AsyncIterable<Record<string, string>> {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    let headers: string[] = []
    let isFirst = true

    for await (const line of rl) {
      if (!line.trim()) continue
      if (isFirst) {
        headers = line.split(',').map(h => h.trim().replace(/^"|"$/g, ''))
        isFirst = false
        continue
      }
      const values = this._parseCsvLine(line)
      const row: Record<string, string> = {}
      headers.forEach((h, i) => { row[h] = (values[i] ?? '').replace(/^"|"$/g, '').trim() })
      yield row
    }
  }

  private _parseCsvLine(line: string): string[] {
    const result: string[] = []
    let cur = ''
    let inQuote = false
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue }
      if (ch === ',' && !inQuote) { result.push(cur); cur = ''; continue }
      cur += ch
    }
    result.push(cur)
    return result
  }
}
