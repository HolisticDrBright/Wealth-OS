'use client'

import { useState, useEffect, useCallback } from 'react'
import { Topbar } from '@/components/layout/topbar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Play, RefreshCw, TrendingUp, TrendingDown, Clock, Target, FlaskConical } from 'lucide-react'
import { STRATEGY_REGISTRY_CONFIG } from '@/lib/strategies/strategy-registry'
import type { StrategyKey, AssetClass } from '@/lib/strategies/strategy-registry'
import type { PaperSummary } from '@/lib/paper-trading/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StrategyRow {
  strategyKey: StrategyKey
  displayName: string
  assetClass: AssetClass
  edgeType: string
  paperEnabled: boolean
}

interface Position {
  id: string
  strategy_key: string
  symbol: string
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
  positionsOpened: number
  positionsClosed: number
  errors: string[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  crypto: 'Crypto',
  stocks: 'Stocks',
  options: 'Options',
  forex: 'Forex',
  polymarket: 'Polymarket',
  'multi-asset': 'Multi-Asset',
}

const ASSET_CLASS_COLORS: Record<AssetClass, string> = {
  crypto: 'text-orange-400 border-orange-400/30',
  stocks: 'text-blue-400 border-blue-400/30',
  options: 'text-purple-400 border-purple-400/30',
  forex: 'text-green-400 border-green-400/30',
  polymarket: 'text-pink-400 border-pink-400/30',
  'multi-asset': 'text-gray-400 border-gray-400/30',
}

function toDisplayName(key: string): string {
  return key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function pnlColor(val: number | null) {
  if (val == null) return 'text-muted-foreground'
  return val >= 0 ? 'text-green-400' : 'text-red-400'
}

function fmt(val: number | null, decimals = 2) {
  if (val == null) return '—'
  const sign = val >= 0 ? '+' : ''
  return `${sign}$${Math.abs(val).toFixed(decimals)}`
}

function fmtPct(val: number | null) {
  if (val == null) return '—'
  const sign = val >= 0 ? '+' : ''
  return `${sign}${(val * 100).toFixed(2)}%`
}

function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

const ASSET_CLASS_ORDER: AssetClass[] = ['crypto', 'stocks', 'options', 'forex', 'polymarket', 'multi-asset']

// ─── Toggle component ─────────────────────────────────────────────────────────

function PaperToggle({ enabled, onChange, disabled }: { enabled: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
        enabled ? 'bg-accent-cyan' : 'bg-white/20'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          enabled ? 'translate-x-4' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PaperTradingPage() {
  const [strategies, setStrategies] = useState<StrategyRow[]>([])
  const [openPos, setOpenPos] = useState<Position[]>([])
  const [recentPos, setRecentPos] = useState<Position[]>([])
  const [summary, setSummary] = useState<PaperSummary | null>(null)
  const [lastRun, setLastRun] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)

  const loadStrategies = useCallback(async () => {
    const res = await fetch('/api/users/me/strategies')
    const data = await res.json() as { strategies: Array<{ strategyKey: StrategyKey; displayName: string; assetClass: AssetClass; edgeType: string; paperEnabled: boolean }> }
    setStrategies(data.strategies ?? [])
  }, [])

  const loadPositions = useCallback(async () => {
    const [p, s] = await Promise.all([
      fetch('/api/paper-trading/positions').then(r => r.json()),
      fetch('/api/paper-trading/summary').then(r => r.json()),
    ])
    setOpenPos((p as { open: Position[] }).open ?? [])
    setRecentPos((p as { recent: Position[] }).recent ?? [])
    setSummary(s as PaperSummary)
  }, [])

  useEffect(() => {
    void loadStrategies()
    void loadPositions()
  }, [loadStrategies, loadPositions])

  async function togglePaper(strategyKey: StrategyKey, current: boolean) {
    setToggling(strategyKey)
    try {
      await fetch('/api/users/me/strategies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy_key: strategyKey, paper_enabled: !current }),
      })
      setStrategies(prev => prev.map(s =>
        s.strategyKey === strategyKey ? { ...s, paperEnabled: !current } : s
      ))
    } finally {
      setToggling(null)
    }
  }

  async function runPaper() {
    setRunning(true)
    try {
      const res = await fetch('/api/paper-trading/run', { method: 'POST' })
      const result = await res.json() as RunResult
      setLastRun(result)
      await loadPositions()
    } finally {
      setRunning(false)
    }
  }

  const enabledCount = strategies.filter(s => s.paperEnabled).length
  const totalPnl = summary?.totalPnlUsd ?? 0

  // Group strategies by asset class
  const byAssetClass = ASSET_CLASS_ORDER.reduce<Record<string, StrategyRow[]>>((acc, cls) => {
    const rows = strategies.filter(s => s.assetClass === cls)
    if (rows.length > 0) acc[cls] = rows
    return acc
  }, {})

  return (
    <div>
      <Topbar
        title="Paper Trading"
        subtitle="Toggle strategies on to simulate with live prices — no real money"
      />

      <div className="p-6 max-w-6xl mx-auto space-y-6">

        {/* Strategy toggles */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-accent-cyan" />
                Paper Mode by Strategy
                {enabledCount > 0 && (
                  <span className="ml-1 text-xs bg-accent-cyan/20 text-accent-cyan px-2 py-0.5 rounded-full">
                    {enabledCount} active
                  </span>
                )}
              </CardTitle>
              <Button
                onClick={runPaper}
                disabled={running || enabledCount === 0}
                size="sm"
                className="gap-2 h-8"
              >
                {running
                  ? <RefreshCw className="h-3 w-3 animate-spin" />
                  : <Play className="h-3 w-3" />}
                {running ? 'Running…' : `Run ${enabledCount > 0 ? `(${enabledCount})` : ''}`}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {Object.entries(byAssetClass).map(([cls, rows]) => (
              <div key={cls}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {ASSET_CLASS_LABELS[cls as AssetClass]}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {rows.map(s => (
                    <div
                      key={s.strategyKey}
                      className={`flex items-center justify-between rounded-lg px-3 py-2 transition-colors ${
                        s.paperEnabled ? 'bg-accent-cyan/5 border border-accent-cyan/20' : 'bg-muted/20 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-medium text-foreground truncate">
                          {s.displayName}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] shrink-0 ${ASSET_CLASS_COLORS[s.assetClass]}`}
                        >
                          {s.edgeType}
                        </Badge>
                      </div>
                      <PaperToggle
                        enabled={s.paperEnabled}
                        onChange={() => void togglePaper(s.strategyKey, s.paperEnabled)}
                        disabled={toggling === s.strategyKey}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {strategies.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">Loading strategies…</p>
            )}
          </CardContent>
        </Card>

        {/* Last run banner */}
        {lastRun && (
          <div className="bg-muted/30 border border-border/50 rounded-lg px-4 py-3 text-xs space-y-1">
            <p className="font-medium text-foreground">
              Last run: {new Date(lastRun.runAt).toLocaleTimeString()} — {lastRun.strategiesRun} strategies,{' '}
              {lastRun.opportunitiesFound} opportunities, {lastRun.positionsOpened} opened,{' '}
              {lastRun.positionsClosed} closed
            </p>
            {lastRun.errors.length > 0 && (
              <p className="text-yellow-400">
                {lastRun.errors[0]}{lastRun.errors.length > 1 ? ` +${lastRun.errors.length - 1} more` : ''}
              </p>
            )}
          </div>
        )}

        {/* Summary row */}
        {(openPos.length > 0 || (summary?.closedTrades ?? 0) > 0) && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total P&L', value: fmt(totalPnl), cls: pnlColor(totalPnl) },
              { label: 'Win Rate', value: summary?.winRate != null ? `${(summary.winRate * 100).toFixed(0)}%` : '—', cls: '' },
              { label: 'Open', value: String(openPos.length), cls: '' },
              { label: 'Closed', value: String(summary?.closedTrades ?? 0), cls: '' },
            ].map(t => (
              <div key={t.label} className="bg-muted/30 rounded-lg p-3 space-y-0.5">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{t.label}</p>
                <p className={`text-lg font-semibold ${t.cls || 'text-foreground'}`}>{t.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Open Positions */}
        {openPos.length > 0 && (
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Target className="h-4 w-4 text-accent-cyan" />
                Open Positions ({openPos.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border/50">
                      <th className="text-left pb-2 font-medium">Strategy</th>
                      <th className="text-left pb-2 font-medium">Symbol</th>
                      <th className="text-left pb-2 font-medium">Dir</th>
                      <th className="text-right pb-2 font-medium">Entry</th>
                      <th className="text-right pb-2 font-medium">Current</th>
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
                          <Badge variant="outline" className={`text-[10px] ${p.direction === 'long' ? 'text-green-400 border-green-500/30' : 'text-red-400 border-red-500/30'}`}>
                            {p.direction.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="py-2 text-right">${p.entry_price.toFixed(4)}</td>
                        <td className="py-2 text-right">{p.current_price != null ? `$${p.current_price.toFixed(4)}` : '—'}</td>
                        <td className={`py-2 text-right font-medium ${pnlColor(p.unrealized_pnl_usd)}`}>
                          {fmtPct(p.unrealized_pnl_pct)}
                          <span className="text-muted-foreground ml-1">({fmt(p.unrealized_pnl_usd)})</span>
                        </td>
                        <td className="py-2 text-right text-muted-foreground">
                          <Clock className="inline h-3 w-3 mr-0.5" />{timeAgo(p.opened_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent Closed */}
        {recentPos.length > 0 && (
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                Recent Closed Trades
              </CardTitle>
            </CardHeader>
            <CardContent>
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
                          <Badge variant="outline" className={`text-[10px] ${p.direction === 'long' ? 'text-green-400 border-green-500/30' : 'text-red-400 border-red-500/30'}`}>
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
                          <Badge variant="secondary" className="text-[10px]">{p.exit_reason ?? 'manual'}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  )
}
