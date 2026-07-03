/**
 * PositionMonitor -- 24/7 position management worker.
 *
 * Polls open positions from Supabase every POLL_INTERVAL_MS (default 30s),
 * fetches current prices, and calls the strategy's manageOpenPosition() for
 * each position. Executes any non-hold action via the broker adapter.
 *
 * Run on Hetzner VPS via systemd (see deploy/systemd/wealth-os-position-monitor.service).
 * The same class can be embedded in tests or Next.js API routes for integration.
 *
 * Reconnect (price feed restart after silence):
 *   delays: 1s, 2s, 4s, 8s, 16s, 32s, 60s (capped)
 */

import { createClient } from '@supabase/supabase-js'
import http from 'node:http'
import { fetchCurrentPrice } from '@/lib/paper-trading/price-feed'
import type { OpenPosition, PriceTick, ManageAction } from '@/lib/strategies/pipeline-types'
import type { StrategyKey } from '@/lib/strategies/strategy-registry'

// ─── Config ───────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS  = 30_000   // 30s between full position sweeps
const HEARTBEAT_MS      = 30_000   // write heartbeat to Supabase every 30s
const SILENCE_RESTART_MS = 5 * 60_000  // restart poll loop if silent for 5 min
const MAX_BACKOFF_MS    = 60_000   // cap reconnect backoff at 60s

// ─── Strategy registry (lazy import to avoid circular deps) ───────────────────

async function getStrategyInstance(key: StrategyKey) {
  // Dynamic import keeps the monitor decoupled from the full strategy graph
  try {
    const { getAllPipelineStrategies } = await import('@/lib/strategies/all-pipeline-strategies')
    return getAllPipelineStrategies().find(s => s.key === key) ?? null
  } catch {
    return null
  }
}

// ─── Row shape from paper_positions ──────────────────────────────────────────

interface PaperPositionRow {
  id: string
  user_id: string
  strategy_key: string
  symbol: string
  asset_class: string
  direction: 'long' | 'short' | 'neutral'
  entry_price: number
  current_price: number
  quantity: number
  notional_usd: number
  stop_loss_pct: number
  take_profit_pct: number
  max_hold_hours: number
  opened_at: string
  metadata: Record<string, unknown>
}

function rowToPosition(row: PaperPositionRow): OpenPosition {
  return {
    id: row.id,
    strategyKey: row.strategy_key,
    symbol: row.symbol,
    assetClass: row.asset_class as OpenPosition['assetClass'],
    direction: row.direction,
    entryPrice: row.entry_price,
    currentPrice: row.current_price,
    quantity: row.quantity,
    notionalUsd: row.notional_usd,
    stopLossPct: row.stop_loss_pct,
    takeProfitPct: row.take_profit_pct,
    maxHoldHours: row.max_hold_hours,
    openedAt: new Date(row.opened_at).getTime(),
    metadata: row.metadata ?? {},
  }
}

// ─── PositionMonitor ─────────────────────────────────────────────────────────

export class PositionMonitor {
  private readonly supabase: ReturnType<typeof createClient>
  private running = false
  private lastTickMs = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private silenceTimer: ReturnType<typeof setTimeout> | null = null
  private backoffIdx = 0
  private readonly backoffSequence = [1000, 2000, 4000, 8000, 16000, 32000, 60000]
  private httpServer: http.Server | null = null
  private positionsTracked = 0
  private readonly startedAt = Date.now()

  constructor() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
    // Service-role ONLY. The old silent fallback to the anon key meant the
    // worker ran with RLS-restricted reads and quietly managed nothing.
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
    if (!url) throw new Error('Supabase URL not set for PositionMonitor')
    if (!key) {
      throw new Error(
        'PositionMonitor requires SUPABASE_SERVICE_ROLE_KEY — refusing to fall back to the anon key'
      )
    }
    this.supabase = createClient(url, key)
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return
    this.running = true
    console.log('Position Monitor started, connecting to Supabase + brokers...')
    this.startHealthServer()
    this.heartbeatTimer = setInterval(() => { void this.writeHeartbeat() }, HEARTBEAT_MS)
    void this.pollLoop()
  }

  private startHealthServer(): void {
    const port = parseInt(process.env.PORT ?? '3001', 10)
    this.httpServer = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          status: 'ok',
          uptime: Math.floor((Date.now() - this.startedAt) / 1000),
          positionsTracked: this.positionsTracked,
        }))
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    this.httpServer.listen(port, () => {
      console.log(`[PositionMonitor] /health endpoint on port ${port}`)
    })
  }

  stop(): void {
    this.running = false
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.silenceTimer) clearTimeout(this.silenceTimer)
    this.httpServer?.close()
    console.log('[PositionMonitor] stopped')
  }

  /** Called by the poll loop for each (position, price) pair. */
  async onTick(position: OpenPosition, tick: PriceTick): Promise<void> {
    this.lastTickMs = Date.now()
    this.resetSilenceTimer()

    const strategy = await getStrategyInstance(position.strategyKey as StrategyKey)
    if (!strategy) return

    let action: ManageAction
    try {
      action = await strategy.manageOpenPosition(position, tick)
    } catch (err) {
      console.warn(`[PositionMonitor] manageOpenPosition error for ${position.id}:`, err)
      return
    }

    if (action.type !== 'hold') {
      await this.applyAction(position, action, tick)
    }
  }

  /** Called when a broker fill event arrives (e.g. take-profit hit). */
  async onFill(positionId: string, reason: string): Promise<void> {
    console.log(`[PositionMonitor] fill event for position ${positionId}: ${reason}`)
    await this.closePosition(positionId, reason)
  }

  /** Execute a ManageAction against the position. */
  async applyAction(position: OpenPosition, action: ManageAction, tick: PriceTick): Promise<void> {
    if (action.type === 'hold') return

    console.log(`[PositionMonitor] ${position.strategyKey} ${position.symbol} action=${action.type} reason="${'reason' in action ? action.reason : ''}"`)

    if (action.type === 'close') {
      await this.closePosition(position.id, action.reason)
      return
    }

    if (action.type === 'adjustStop') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.supabase.from('paper_positions') as any)
        .update({ stop_price_absolute: action.newStop, updated_at: new Date().toISOString() })
        .eq('id', position.id)
      console.log(`[PositionMonitor] adjusted stop for ${position.id} to ${action.newStop} (${action.reason})`)
      return
    }

    if (action.type === 'adjustTarget') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.supabase.from('paper_positions') as any)
        .update({ take_profit_price_absolute: action.newTarget, updated_at: new Date().toISOString() })
        .eq('id', position.id)
      console.log(`[PositionMonitor] adjusted target for ${position.id} to ${action.newTarget} (${action.reason})`)
      return
    }

    console.warn(`[PositionMonitor] unknown action type from tick ${tick.symbol}`)
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.sweep()
        this.backoffIdx = 0  // successful sweep resets backoff
      } catch (err) {
        console.error('[PositionMonitor] sweep error:', err)
        await this.backoff()
      }
      await sleep(POLL_INTERVAL_MS)
    }
  }

  private async sweep(): Promise<void> {
    // OCO reconciliation from order_intents: verify bracket legs after entry
    // fills, cancel siblings on stop/TP fills, resize legs on partial fills.
    try {
      const { reconcileOrderIntents } = await import('@/lib/broker-adapters/reconciler')
      const { defaultReconcilerOps } = await import('@/lib/broker-adapters/reconciler-ops')
      const report = await reconcileOrderIntents(this.supabase as never, defaultReconcilerOps())
      if (report.cancelled || report.reduced || report.missingLegs || report.errors.length) {
        console.log(
          `[PositionMonitor] reconcile: scanned=${report.scanned} cancelled=${report.cancelled} ` +
          `reduced=${report.reduced} missingLegs=${report.missingLegs} errors=${report.errors.length}`
        )
        for (const e of report.errors) console.warn(`[PositionMonitor] reconcile error: ${e}`)
      }
    } catch (err) {
      console.warn('[PositionMonitor] reconcile pass failed:', err)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rawRows, error } = await (this.supabase.from('paper_positions') as any)
      .select('id, user_id, strategy_key, symbol, asset_class, direction, entry_price, current_price, quantity, notional_usd, stop_loss_pct, take_profit_pct, max_hold_hours, opened_at, metadata')
      .eq('status', 'open')
      .order('opened_at', { ascending: true }) as { data: PaperPositionRow[] | null; error: { message: string } | null }

    if (error) throw new Error(`sweep select: ${error.message}`)
    const rows = rawRows ?? []
    this.positionsTracked = rows.length
    if (!rows.length) return

    // Deduplicate symbols to fetch prices efficiently
    const symbols = [...new Set(rows.map(r => ({ symbol: r.symbol, ac: r.asset_class })).map(x => `${x.symbol}|${x.ac}`))]

    const priceMap = new Map<string, number>()
    await Promise.all(
      symbols.map(async s => {
        const [symbol, ac] = s.split('|')
        const price = await fetchCurrentPrice(symbol, ac as never)
        if (price != null && isFinite(price) && price > 0) priceMap.set(s, price)
      })
    )

    for (const row of rows) {
      const key = `${row.symbol}|${row.asset_class}`
      const price = priceMap.get(key)
      if (!price) continue

      const position = rowToPosition(row)
      const tick: PriceTick = { symbol: row.symbol as string, price, timestamp: Date.now() }

      await this.onTick(position, tick)
    }
  }

  private async closePosition(positionId: string, reason: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row } = await (this.supabase.from('paper_positions') as any)
      .select('entry_price, current_price, quantity, notional_usd, direction, strategy_key, symbol')
      .eq('id', positionId)
      .single() as { data: Partial<PaperPositionRow> | null }

    if (!row) return

    const entry   = row.entry_price   ?? 0
    const current = row.current_price ?? entry
    const rawReturn = entry > 0 ? (current - entry) / entry : 0
    const realizedPct = row.direction === 'short' ? -rawReturn : rawReturn
    const realizedUsd = realizedPct * (row.notional_usd ?? 0)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.supabase.from('paper_positions') as any)
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        exit_price: current,
        realized_pnl_pct: realizedPct,
        realized_pnl_usd: realizedUsd,
        close_reason: reason,
      })
      .eq('id', positionId)

    console.log(`[PositionMonitor] closed ${row.strategy_key} ${row.symbol} reason="${reason}" pnl=${(realizedPct * 100).toFixed(2)}%`)
  }

  private async writeHeartbeat(): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.supabase.from('worker_heartbeats') as any)
        .upsert({ worker: 'position_monitor', last_seen: new Date().toISOString(), pid: process.pid }, { onConflict: 'worker' })
    } catch {
      // non-fatal
    }
  }

  private resetSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer)
    this.silenceTimer = setTimeout(() => {
      console.warn('[PositionMonitor] silent for 5 min — restarting poll loop')
      void this.pollLoop()
    }, SILENCE_RESTART_MS)
  }

  private async backoff(): Promise<void> {
    const delay = this.backoffSequence[Math.min(this.backoffIdx, this.backoffSequence.length - 1)]
    console.warn(`[PositionMonitor] backing off ${delay}ms (attempt ${this.backoffIdx + 1})`)
    this.backoffIdx++
    await sleep(delay)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── CLI entrypoint ──────────────────────────────────────────────────────────

if (require.main === module) {
  const monitor = new PositionMonitor()
  monitor.start()

  process.on('SIGTERM', () => { monitor.stop(); process.exit(0) })
  process.on('SIGINT',  () => { monitor.stop(); process.exit(0) })
}
