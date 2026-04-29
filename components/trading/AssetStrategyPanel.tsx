'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Play, RefreshCw, TrendingUp, TrendingDown, Clock, FlaskConical, Zap, Fish, Atom, AlertTriangle, Info } from 'lucide-react'
import type { StrategyKey, AssetClass, MiroFishTier, KronosTier } from '@/lib/strategies/strategy-registry'
import type { PaperSummary } from '@/lib/paper-trading/types'

interface StrategyRow {
  strategyKey: StrategyKey
  displayName: string
  assetClass: AssetClass
  edgeType: string
  mirofish: MiroFishTier
  kronos: KronosTier
  paperEnabled: boolean
  missingRequired: string[]
  missingOptional: string[]
}

interface Position {
  id: string
  strategy_key: string
  symbol: string
  direction: 'long' | 'short'
  entry_price: number
  current_price: number | null
  exit_price: number | null
  notional_usd: number
  unrealized_pnl_usd: number | null
  unrealized_pnl_pct: number | null
  realized_pnl_usd: number | null
  realized_pnl_pct: number | null
  exit_reason: string | null
  opened_at: string
}

interface Props {
  assetClasses: AssetClass[]
}

function pnlColor(v: number | null) {
  if (v == null) return 'text-muted-foreground'
  return v >= 0 ? 'text-green-400' : 'text-red-400'
}
function fmt(v: number | null) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}$${Math.abs(v).toFixed(2)}`
}
function fmtPct(v: number | null) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`
}
function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function ApiWarning({ missingRequired, missingOptional }: { missingRequired: string[]; missingOptional: string[] }) {
  if (missingRequired.length === 0 && missingOptional.length === 0) return null

  if (missingRequired.length > 0) {
    const tip = `Needs ${missingRequired.join(', ')} — strategy will return no signals without it`
    return (
      <span title={tip} className="shrink-0 cursor-help">
        <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />
      </span>
    )
  }

  const tip = `Add ${missingOptional.join(', ')} for full signals (runs with reduced data without it)`
  return (
    <span title={tip} className="shrink-0 cursor-help">
      <Info className="h-3.5 w-3.5 text-yellow-500/70" />
    </span>
  )
}

function AiTierBadge({ tier, label, icon }: { tier: MiroFishTier | KronosTier; label: string; icon: React.ReactNode }) {
  if (tier === 'skip') return null
  const cls = tier === 'high'
    ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
    : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium border shrink-0 ${cls}`}>
      {icon}
      {label}
    </span>
  )
}

function PaperToggle({ enabled, onChange, disabled }: { enabled: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${enabled ? 'bg-accent-cyan' : 'bg-white/20'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-1'}`} />
    </button>
  )
}

export function AssetStrategyPanel({ assetClasses }: Props) {
  const [mode, setMode] = useState<'paper' | 'live'>('paper')
  const [strategies, setStrategies] = useState<StrategyRow[]>([])
  const [openPos, setOpenPos] = useState<Position[]>([])
  const [recentPos, setRecentPos] = useState<Position[]>([])
  const [summary, setSummary] = useState<PaperSummary | null>(null)
  const [running, setRunning] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const [runMsg, setRunMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const primaryClass = assetClasses[0]

  const loadPositions = useCallback(async () => {
    const [p, s] = await Promise.all([
      fetch(`/api/paper-trading/positions?assetClass=${primaryClass}`).then(r => r.json()),
      fetch(`/api/paper-trading/summary?assetClass=${primaryClass}`).then(r => r.json()),
    ])
    setOpenPos((p as { open: Position[] }).open ?? [])
    setRecentPos((p as { recent: Position[] }).recent ?? [])
    setSummary(s as PaperSummary)
  }, [primaryClass])

  useEffect(() => {
    fetch('/api/users/me/strategies')
      .then(r => r.json())
      .then((data: { strategies: StrategyRow[] }) => {
        setStrategies((data.strategies ?? []).filter(s => assetClasses.includes(s.assetClass)))
      })
    void loadPositions()
  }, [assetClasses, loadPositions])

  async function togglePaper(key: StrategyKey, current: boolean) {
    setToggling(key)
    // Optimistic update
    setStrategies(prev => prev.map(s => s.strategyKey === key ? { ...s, paperEnabled: !current } : s))
    try {
      const res = await fetch('/api/users/me/strategies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy_key: key, paper_enabled: !current }),
      })
      if (!res.ok) {
        // Revert on failure
        setStrategies(prev => prev.map(s => s.strategyKey === key ? { ...s, paperEnabled: current } : s))
        const body = await res.json().catch(() => ({})) as { error?: string }
        setRunMsg({ text: `Failed to save: ${body.error ?? res.statusText}`, ok: false })
      }
    } catch {
      setStrategies(prev => prev.map(s => s.strategyKey === key ? { ...s, paperEnabled: current } : s))
      setRunMsg({ text: 'Network error — toggle not saved', ok: false })
    } finally {
      setToggling(null)
    }
  }

  async function runPaper() {
    setRunning(true)
    setRunMsg(null)
    try {
      const res = await fetch('/api/paper-trading/run', { method: 'POST' })
      const result = await res.json() as {
        strategiesRun: number; opportunitiesFound: number
        positionsOpened: number; positionsClosed: number; errors: string[]
      }
      if (result.errors?.[0] && result.strategiesRun === 0) {
        setRunMsg({ text: result.errors[0], ok: false })
      } else {
        setRunMsg({
          text: `Ran ${result.strategiesRun} strategies · ${result.opportunitiesFound} opportunities · ${result.positionsOpened} opened · ${result.positionsClosed} closed${result.errors.length > 0 ? ` · ⚠ ${result.errors[0]}` : ''}`,
          ok: true,
        })
      }
      await loadPositions()
    } finally {
      setRunning(false)
    }
  }

  const enabledCount = strategies.filter(s => s.paperEnabled).length
  const totalPnl = summary?.totalPnlUsd ?? 0

  return (
    <div className="flex flex-col gap-4">
      {/* Header with Paper/Live toggle */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
          <FlaskConical className="h-4 w-4" />
          Strategies
        </h2>
        <div className="flex items-center gap-1 rounded-lg bg-white/5 border border-white/10 p-0.5">
          <button
            onClick={() => setMode('paper')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${mode === 'paper' ? 'bg-accent-cyan/20 text-accent-cyan' : 'text-gray-400 hover:text-white'}`}
          >
            Paper
          </button>
          <button
            onClick={() => setMode('live')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 ${mode === 'live' ? 'bg-green-500/20 text-green-400' : 'text-gray-400 hover:text-white'}`}
          >
            <Zap className="h-3 w-3" />
            Live
          </button>
        </div>
      </div>

      {mode === 'live' ? (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-8 text-center">
          <Zap className="h-6 w-6 text-gray-500 mx-auto mb-2" />
          <p className="text-sm text-gray-400">Live strategy execution coming soon</p>
          <p className="text-xs text-gray-600 mt-1">Enable Paper mode to simulate trades with live prices</p>
        </div>
      ) : (
        <>
          {/* Strategy toggles */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <p className="text-xs text-gray-500">
                  {enabledCount > 0 ? `${enabledCount} strategy${enabledCount !== 1 ? 'ies' : 'y'} in paper mode` : 'Toggle strategies to simulate'}
                </p>
                <span className="text-[10px] text-gray-600 hidden sm:inline">
                  <span className="text-indigo-400">MF</span>=MiroFish · <span className="text-indigo-400">KR</span>=Kronos
                </span>
              </div>
              <Button
                size="sm"
                disabled={running || enabledCount === 0}
                onClick={runPaper}
                className="h-7 text-xs gap-1.5"
              >
                {running ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                {running ? 'Running…' : `Run Paper${enabledCount > 0 ? ` (${enabledCount})` : ''}`}
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {strategies.map(s => (
                <div
                  key={s.strategyKey}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 transition-colors ${s.paperEnabled ? 'bg-accent-cyan/5 border border-accent-cyan/20' : 'bg-white/5 border border-transparent'}`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-xs font-medium text-foreground truncate">{s.displayName}</span>
                    <Badge variant="default" className="text-[10px] shrink-0 text-gray-500 border-gray-600/50">{s.edgeType}</Badge>
                    <AiTierBadge tier={s.mirofish} label="MF" icon={<Fish className="h-2.5 w-2.5" />} />
                    <AiTierBadge tier={s.kronos} label="KR" icon={<Atom className="h-2.5 w-2.5" />} />
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <ApiWarning missingRequired={s.missingRequired ?? []} missingOptional={s.missingOptional ?? []} />
                    <PaperToggle
                      enabled={s.paperEnabled}
                      onChange={() => void togglePaper(s.strategyKey, s.paperEnabled)}
                      disabled={toggling === s.strategyKey}
                    />
                  </div>
                </div>
              ))}
              {strategies.length === 0 && (
                <p className="text-xs text-gray-500 col-span-2 py-2">Loading…</p>
              )}
            </div>
          </div>

          {/* Run result banner */}
          {runMsg && (
            <div className={`rounded-lg px-3 py-2 text-xs ${runMsg.ok ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'}`}>
              {runMsg.text}
            </div>
          )}

          {/* P&L summary */}
          {(openPos.length > 0 || (summary?.closedTrades ?? 0) > 0) && (
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Total P&L', value: fmt(totalPnl), cls: pnlColor(totalPnl) },
                { label: 'Win Rate', value: summary?.winRate != null ? `${(summary.winRate * 100).toFixed(0)}%` : '—', cls: '' },
                { label: 'Open', value: String(openPos.length), cls: '' },
                { label: 'Closed', value: String(summary?.closedTrades ?? 0), cls: '' },
              ].map(t => (
                <div key={t.label} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wider">{t.label}</p>
                  <p className={`text-lg font-bold mt-0.5 ${t.cls || 'text-white'}`}>{t.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Open positions */}
          {openPos.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Paper Positions</h3>
              <div className="rounded-xl border border-white/10 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">Strategy</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">Symbol</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">Dir</th>
                      <th className="text-right px-3 py-2 text-gray-500 font-medium">Entry</th>
                      <th className="text-right px-3 py-2 text-gray-500 font-medium">Current</th>
                      <th className="text-right px-3 py-2 text-gray-500 font-medium">P&L</th>
                      <th className="text-right px-3 py-2 text-gray-500 font-medium">Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openPos.map(p => (
                      <tr key={p.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="px-3 py-2 font-mono text-gray-400">{p.strategy_key}</td>
                        <td className="px-3 py-2 font-semibold text-white">{p.symbol}</td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${p.direction === 'long' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                            {p.direction.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-gray-300">${p.entry_price.toFixed(4)}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-300">{p.current_price != null ? `$${p.current_price.toFixed(4)}` : '—'}</td>
                        <td className={`px-3 py-2 text-right font-medium ${pnlColor(p.unrealized_pnl_usd)}`}>
                          {fmtPct(p.unrealized_pnl_pct)} <span className="text-gray-500">({fmt(p.unrealized_pnl_usd)})</span>
                        </td>
                        <td className="px-3 py-2 text-right text-gray-500 flex items-center justify-end gap-1">
                          <Clock className="h-3 w-3" />{timeAgo(p.opened_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent closed */}
          {recentPos.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Recent Closed Trades</h3>
              <div className="rounded-xl border border-white/10 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">Strategy</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">Symbol</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">Dir</th>
                      <th className="text-right px-3 py-2 text-gray-500 font-medium">Entry</th>
                      <th className="text-right px-3 py-2 text-gray-500 font-medium">Exit</th>
                      <th className="text-right px-3 py-2 text-gray-500 font-medium">P&L</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentPos.map(p => (
                      <tr key={p.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="px-3 py-2 font-mono text-gray-400">{p.strategy_key}</td>
                        <td className="px-3 py-2 font-semibold text-white">{p.symbol}</td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${p.direction === 'long' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                            {p.direction.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-gray-300">${p.entry_price.toFixed(4)}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-300">{p.exit_price != null ? `$${p.exit_price.toFixed(4)}` : '—'}</td>
                        <td className={`px-3 py-2 text-right font-medium ${pnlColor(p.realized_pnl_usd)}`}>
                          {fmtPct(p.realized_pnl_pct)}
                          {p.realized_pnl_usd != null && (
                            <span className="text-gray-500 ml-1">
                              ({p.realized_pnl_usd >= 0 ? <TrendingUp className="inline h-3 w-3 text-green-400" /> : <TrendingDown className="inline h-3 w-3 text-red-400" />}
                              {fmt(p.realized_pnl_usd)})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span className="px-1.5 py-0.5 rounded bg-white/10 text-gray-400 text-[10px]">{p.exit_reason ?? 'manual'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
