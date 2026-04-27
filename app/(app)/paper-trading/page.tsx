'use client'

import { useState, useEffect, useCallback } from 'react'
import { Topbar } from '@/components/layout/topbar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Play, RefreshCw, TrendingUp, TrendingDown, Clock, Target } from 'lucide-react'
import type { PaperSummary } from '@/lib/paper-trading/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Position {
  id: string
  strategy_key: string
  symbol: string
  asset_class: string
  direction: 'long' | 'short'
  entry_price: number
  current_price: number | null
  exit_price: number | null
  quantity: number
  notional_usd: number
  unrealized_pnl_usd: number | null
  unrealized_pnl_pct: number | null
  realized_pnl_usd: number | null
  realized_pnl_pct: number | null
  status: 'open' | 'closed' | 'stopped'
  exit_reason: string | null
  opened_at: string
  closed_at: string | null
}

interface RunResult {
  runAt: string
  strategiesRun: number
  opportunitiesFound: number
  decisionsExecute: number
  decisionsBlock: number
  positionsOpened: number
  positionsClosed: number
  errors: string[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pnlColor(val: number | null) {
  if (val == null) return 'text-muted-foreground'
  return val >= 0 ? 'text-green-400' : 'text-red-400'
}

function fmt(val: number | null, prefix = '$', decimals = 2) {
  if (val == null) return '—'
  const sign = val >= 0 ? '+' : ''
  return `${sign}${prefix}${Math.abs(val).toFixed(decimals)}`
}

function fmtPct(val: number | null) {
  if (val == null) return '—'
  const sign = val >= 0 ? '+' : ''
  return `${sign}${(val * 100).toFixed(2)}%`
}

function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60)   return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

// ─── Stat tile ────────────────────────────────────────────────────────────────

function StatTile({
  label, value, sub, valueClass,
}: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="bg-muted/30 rounded-lg p-4 space-y-1">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-semibold ${valueClass ?? 'text-foreground'}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PaperTradingPage() {
  const [summary, setSummary]       = useState<PaperSummary | null>(null)
  const [openPos, setOpenPos]       = useState<Position[]>([])
  const [recentPos, setRecentPos]   = useState<Position[]>([])
  const [lastRun, setLastRun]       = useState<RunResult | null>(null)
  const [running, setRunning]       = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([
      fetch('/api/paper-trading/summary').then(r => r.json()),
      fetch('/api/paper-trading/positions').then(r => r.json()),
    ])
    setSummary(s as PaperSummary)
    setOpenPos((p as { open: Position[] }).open ?? [])
    setRecentPos((p as { recent: Position[] }).recent ?? [])
  }, [])

  useEffect(() => { void load() }, [load])

  async function runStrategies() {
    setRunning(true)
    try {
      const res = await fetch('/api/paper-trading/run', { method: 'POST' })
      const result = await res.json() as RunResult
      setLastRun(result)
      await load()
    } finally {
      setRunning(false)
    }
  }

  async function refresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const totalPnl = summary?.totalPnlUsd ?? 0

  return (
    <div>
      <Topbar
        title="Paper Trading"
        subtitle="Simulate all strategies with live market prices — no real money"
      />

      <div className="p-6 max-w-6xl mx-auto space-y-6">

        {/* Controls */}
        <div className="flex items-center gap-3">
          <Button onClick={runStrategies} disabled={running} className="gap-2">
            {running
              ? <RefreshCw className="h-4 w-4 animate-spin" />
              : <Play className="h-4 w-4" />}
            {running ? 'Running strategies…' : 'Run Strategies Now'}
          </Button>
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} className="gap-2">
            <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <p className="text-xs text-muted-foreground">
            Paper mode — fills at live mid-price ± slippage. No real orders placed.
          </p>
        </div>

        {/* Last run banner */}
        {lastRun && (
          <div className="bg-muted/30 border border-border/50 rounded-lg px-4 py-3 text-xs space-y-1">
            <p className="font-medium text-foreground">
              Last run: {new Date(lastRun.runAt).toLocaleTimeString()} — {lastRun.strategiesRun} strategies,{' '}
              {lastRun.opportunitiesFound} opportunities, {lastRun.positionsOpened} opened,{' '}
              {lastRun.positionsClosed} closed
            </p>
            {lastRun.errors.length > 0 && (
              <p className="text-yellow-400">{lastRun.errors.length} error(s): {lastRun.errors[0]}{lastRun.errors.length > 1 ? ` +${lastRun.errors.length - 1} more` : ''}</p>
            )}
          </div>
        )}

        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile
            label="Total P&L"
            value={fmt(totalPnl)}
            sub={`${fmt(summary?.totalRealizedPnlUsd ?? null)} realized`}
            valueClass={pnlColor(totalPnl)}
          />
          <StatTile
            label="Win Rate"
            value={summary?.winRate != null ? `${(summary.winRate * 100).toFixed(0)}%` : '—'}
            sub={`${summary?.closedTrades ?? 0} closed trades`}
          />
          <StatTile
            label="Open Positions"
            value={String(summary?.openPositions ?? openPos.length)}
            sub={fmt(summary?.totalUnrealizedPnlUsd ?? null) + ' unrealized'}
            valueClass={pnlColor(summary?.totalUnrealizedPnlUsd ?? null)}
          />
          <StatTile
            label="Avg Win / Loss"
            value={summary?.avgWinUsd != null ? fmt(summary.avgWinUsd) : '—'}
            sub={summary?.avgLossUsd != null ? `Loss: ${fmt(summary.avgLossUsd)}` : 'No closed trades yet'}
            valueClass="text-green-400"
          />
        </div>

        {/* Open Positions */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4 text-accent-cyan" />
              Open Positions ({openPos.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {openPos.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No open positions. Click "Run Strategies Now" to detect opportunities.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border/50">
                      <th className="text-left pb-2 font-medium">Strategy</th>
                      <th className="text-left pb-2 font-medium">Symbol</th>
                      <th className="text-left pb-2 font-medium">Dir</th>
                      <th className="text-right pb-2 font-medium">Entry</th>
                      <th className="text-right pb-2 font-medium">Current</th>
                      <th className="text-right pb-2 font-medium">Notional</th>
                      <th className="text-right pb-2 font-medium">P&L</th>
                      <th className="text-right pb-2 font-medium">Age</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {openPos.map(p => (
                      <tr key={p.id} className="hover:bg-muted/20">
                        <td className="py-2 font-mono text-foreground/70">{p.strategy_key}</td>
                        <td className="py-2 font-semibold">{p.symbol}</td>
                        <td className="py-2">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${p.direction === 'long' ? 'text-green-400 border-green-500/30' : 'text-red-400 border-red-500/30'}`}
                          >
                            {p.direction.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="py-2 text-right">${p.entry_price.toFixed(4)}</td>
                        <td className="py-2 text-right">{p.current_price != null ? `$${p.current_price.toFixed(4)}` : '—'}</td>
                        <td className="py-2 text-right">${p.notional_usd.toFixed(0)}</td>
                        <td className={`py-2 text-right font-medium ${pnlColor(p.unrealized_pnl_usd)}`}>
                          {fmtPct(p.unrealized_pnl_pct)}
                          <span className="text-muted-foreground ml-1">({fmt(p.unrealized_pnl_usd)})</span>
                        </td>
                        <td className="py-2 text-right text-muted-foreground flex items-center justify-end gap-1">
                          <Clock className="h-3 w-3" />{timeAgo(p.opened_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Strategy Breakdown */}
        {summary && Object.keys(summary.byStrategy).length > 0 && (
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">P&L by Strategy</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Object.entries(summary.byStrategy)
                  .sort(([, a], [, b]) => b.pnlUsd - a.pnlUsd)
                  .map(([key, v]) => (
                    <div key={key} className="flex items-center gap-3">
                      <span className="font-mono text-xs text-foreground/70 w-48 truncate">{key}</span>
                      <div className="flex-1 bg-muted/20 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${v.pnlUsd >= 0 ? 'bg-green-500' : 'bg-red-500'}`}
                          style={{ width: `${Math.min(100, Math.abs(v.pnlUsd) / 10)}%` }}
                        />
                      </div>
                      <span className={`text-xs font-medium w-20 text-right ${pnlColor(v.pnlUsd)}`}>
                        {fmt(v.pnlUsd)}
                      </span>
                      <span className="text-xs text-muted-foreground w-16 text-right">
                        {v.trades} trade{v.trades !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-muted-foreground w-12 text-right">
                        {v.winRate != null ? `${(v.winRate * 100).toFixed(0)}% W` : '—'}
                      </span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent Closed Trades */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              Recent Closed Trades
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentPos.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No closed trades yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border/50">
                      <th className="text-left pb-2 font-medium">Strategy</th>
                      <th className="text-left pb-2 font-medium">Symbol</th>
                      <th className="text-left pb-2 font-medium">Dir</th>
                      <th className="text-right pb-2 font-medium">Entry</th>
                      <th className="text-right pb-2 font-medium">Exit</th>
                      <th className="text-right pb-2 font-medium">P&L</th>
                      <th className="text-left pb-2 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {recentPos.map(p => (
                      <tr key={p.id} className="hover:bg-muted/20">
                        <td className="py-2 font-mono text-foreground/70">{p.strategy_key}</td>
                        <td className="py-2 font-semibold">{p.symbol}</td>
                        <td className="py-2">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${p.direction === 'long' ? 'text-green-400 border-green-500/30' : 'text-red-400 border-red-500/30'}`}
                          >
                            {p.direction.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="py-2 text-right">${p.entry_price.toFixed(4)}</td>
                        <td className="py-2 text-right">{p.exit_price != null ? `$${p.exit_price.toFixed(4)}` : '—'}</td>
                        <td className={`py-2 text-right font-medium ${pnlColor(p.realized_pnl_usd)}`}>
                          {fmtPct(p.realized_pnl_pct)}
                          {p.realized_pnl_usd != null && (
                            <span className="text-muted-foreground ml-1">
                              ({p.realized_pnl_usd >= 0
                                ? <TrendingUp className="inline h-3 w-3 text-green-400" />
                                : <TrendingDown className="inline h-3 w-3 text-red-400" />}
                              {fmt(p.realized_pnl_usd)})
                            </span>
                          )}
                        </td>
                        <td className="py-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {p.exit_reason ?? 'manual'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  )
}
