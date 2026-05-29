'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Play, RefreshCw, TrendingUp, TrendingDown, Clock,
  FlaskConical, Zap, Fish, Atom, AlertTriangle, Info, ChevronDown, ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StrategyKey, AssetClass, MiroFishTier, KronosTier, ProfileKey } from '@/lib/strategies/strategy-registry'
import type { PaperSummary, PaperRunResult, SkipCounts, SkippedDetail } from '@/lib/paper-trading/types'

interface StrategyRow {
  strategyKey: StrategyKey
  displayName: string
  assetClass: AssetClass
  edgeType: string
  mirofish: MiroFishTier
  kronos: KronosTier
  paperEnabled: boolean
  enabledInProfiles: ProfileKey[]
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
  userProfileKey?: ProfileKey
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
    return (
      <span title={`Needs ${missingRequired.join(', ')} — no signals without it`} className="shrink-0 cursor-help">
        <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />
      </span>
    )
  }
  return (
    <span title={`Add ${missingOptional.join(', ')} for full signals`} className="shrink-0 cursor-help">
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
      {icon}{label}
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

// ── Run result summary ─────────────────────────────────────────────────────────

function buildRunSummary(r: PaperRunResult): string {
  const parts: string[] = [`Ran ${r.strategiesRun} strategies · ${r.opportunitiesFound} opportunities`]

  if (r.positionsOpened > 0) parts.push(`${r.positionsOpened} opened`)
  if (r.positionsClosed > 0) parts.push(`${r.positionsClosed} closed`)

  const s = r.skipped
  if (s.alreadyOpen > 0) parts.push(`${s.alreadyOpen} already open`)
  if (s.missingPrice > 0) parts.push(`${s.missingPrice} no price`)
  if (s.expiredMarket > 0) parts.push(`${s.expiredMarket} expired`)
  if (s.resolvedMarket > 0) parts.push(`${s.resolvedMarket} resolved`)
  if (s.venueBlocked > 0) parts.push(`${s.venueBlocked} venue blocked`)
  const blocked = s.riskBlocked + s.profileBlocked + s.positionCapBlocked + s.liquidityBlocked
  if (blocked > 0) parts.push(`${blocked} blocked`)
  if (s.noSize > 0) parts.push(`${s.noSize} no size`)
  if (s.strategyImmature > 0) parts.push(`${s.strategyImmature} not ready`)

  if (r.positionsOpened === 0 && r.positionsClosed === 0) {
    parts.push('· 0 opened')
  }

  return parts.join(' · ')
}

function plainEnglishSummary(r: PaperRunResult): string {
  const { opportunitiesFound, positionsOpened, positionsClosed, skipped } = r

  if (opportunitiesFound === 0) return 'No actionable signals found this run.'

  const lines: string[] = []

  if (positionsOpened > 0) {
    lines.push(`Opened ${positionsOpened} new position${positionsOpened > 1 ? 's' : ''}.`)
  }
  if (positionsClosed > 0) {
    lines.push(`Closed ${positionsClosed} position${positionsClosed > 1 ? 's' : ''}.`)
  }

  const reasons: string[] = []
  if (skipped.alreadyOpen > 0) reasons.push(`${skipped.alreadyOpen} already held`)
  if (skipped.missingPrice > 0) reasons.push(`${skipped.missingPrice} had no live price`)
  if (skipped.expiredMarket + skipped.resolvedMarket > 0) {
    reasons.push(`${skipped.expiredMarket + skipped.resolvedMarket} Polymarket contracts expired or resolved`)
  }
  if (skipped.venueBlocked > 0) reasons.push(`${skipped.venueBlocked} venue-blocked by jurisdiction`)
  const blocked = skipped.riskBlocked + skipped.profileBlocked
  if (blocked > 0) reasons.push(`${blocked} blocked by risk/profile rules`)
  if (skipped.noSize > 0) reasons.push(`${skipped.noSize} produced zero size after caps`)

  if (reasons.length > 0) {
    if (positionsOpened === 0 && positionsClosed === 0) {
      lines.push(`No new positions opened — ${reasons.join(', ')}.`)
    } else {
      lines.push(`Remaining skipped: ${reasons.join(', ')}.`)
    }
  }

  return lines.join(' ') || `Found ${opportunitiesFound} opportunities, all reviewed.`
}

const OUTCOME_LABEL: Record<string, string> = {
  opened: 'Opened',
  already_open: 'Already open',
  missing_price: 'No price',
  invalid_price: 'Invalid price',
  insert_error: 'DB error',
  no_size: 'No size',
  block: 'Blocked',
  error: 'Error',
  venueBlocked: 'Venue blocked',
  expiredMarket: 'Expired',
  resolvedMarket: 'Resolved',
  strategyImmature: 'Not ready',
}

function outcomeColor(outcome: string) {
  if (outcome === 'opened') return 'text-emerald-400'
  if (outcome === 'already_open') return 'text-gray-400'
  if (outcome === 'missing_price' || outcome === 'invalid_price' || outcome === 'no_active_book') return 'text-amber-400'
  if (outcome === 'block' || outcome === 'insert_error' || outcome === 'error') return 'text-red-400'
  if (outcome === 'expiredMarket' || outcome === 'resolvedMarket' || outcome === 'strategyImmature') return 'text-gray-500'
  return 'text-gray-400'
}

function SkipBreakdown({ skipped, details }: { skipped: SkipCounts; details: SkippedDetail[] }) {
  const [open, setOpen] = useState(false)

  const totalSkipped = Object.values(skipped).reduce((s, v) => s + v, 0)
  if (totalSkipped === 0) return null

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] text-xs">
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-gray-400 hover:text-white transition-colors"
      >
        <span className="flex items-center gap-1.5">
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          <span>Why? — {totalSkipped} skipped</span>
        </span>
        <span className="flex gap-2">
          {skipped.alreadyOpen > 0 && <span className="text-gray-500">{skipped.alreadyOpen} already open</span>}
          {skipped.missingPrice > 0 && <span className="text-amber-500">{skipped.missingPrice} no price</span>}
          {(skipped.riskBlocked + skipped.profileBlocked) > 0 && (
            <span className="text-red-500">{skipped.riskBlocked + skipped.profileBlocked} blocked</span>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-white/10">
          {/* Counts summary row */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-[11px]">
            {(
              [
                ['Already open', skipped.alreadyOpen, 'text-gray-400'],
                ['No price', skipped.missingPrice, 'text-amber-400'],
                ['Expired', skipped.expiredMarket, 'text-gray-500'],
                ['Resolved', skipped.resolvedMarket, 'text-gray-500'],
                ['Risk blocked', skipped.riskBlocked, 'text-red-400'],
                ['Profile blocked', skipped.profileBlocked, 'text-orange-400'],
                ['Venue blocked', skipped.venueBlocked, 'text-red-400'],
                ['Cap blocked', skipped.positionCapBlocked, 'text-amber-400'],
                ['No size', skipped.noSize, 'text-amber-400'],
                ['Not ready', skipped.strategyImmature, 'text-gray-500'],
                ['Other', skipped.other, 'text-gray-500'],
              ] as [string, number, string][]
            )
              .filter(([, count]) => count > 0)
              .map(([label, count, cls]) => (
                <span key={label} className="flex items-center gap-1">
                  <span className={cn('font-semibold tabular-nums', cls)}>{count}</span>
                  <span className="text-gray-600">{label}</span>
                </span>
              ))}
          </div>

          {/* Per-opportunity detail table */}
          {details.length > 0 && (
            <div className="max-h-64 overflow-y-auto border-t border-white/5">
              <table className="w-full">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-white/5">
                    <th className="px-3 py-1.5 text-left font-medium">Strategy</th>
                    <th className="px-3 py-1.5 text-left font-medium">Symbol</th>
                    <th className="px-3 py-1.5 text-left font-medium">Outcome</th>
                    <th className="px-3 py-1.5 text-left font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {details.map((d, i) => (
                    <tr key={i} className="border-b border-white/5 last:border-0">
                      <td className="px-3 py-1.5 font-mono text-gray-500 truncate max-w-[10rem]">{d.strategyKey}</td>
                      <td className="px-3 py-1.5 font-mono text-indigo-400">{d.symbol}</td>
                      <td className={cn('px-3 py-1.5 font-medium', outcomeColor(d.outcome))}>
                        {OUTCOME_LABEL[d.outcome] ?? d.outcome}
                      </td>
                      <td className="px-3 py-1.5 text-gray-500 truncate max-w-[16rem]" title={d.reason}>{d.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function AssetStrategyPanel({ assetClasses, userProfileKey }: Props) {
  const [mode, setMode] = useState<'paper' | 'live'>('paper')
  const [strategies, setStrategies] = useState<StrategyRow[]>([])
  const [openPos, setOpenPos] = useState<Position[]>([])
  const [recentPos, setRecentPos] = useState<Position[]>([])
  const [summary, setSummary] = useState<PaperSummary | null>(null)
  const [running, setRunning] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const [runMsg, setRunMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [lastRun, setLastRun] = useState<PaperRunResult | null>(null)

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
    setStrategies(prev => prev.map(s => s.strategyKey === key ? { ...s, paperEnabled: !current } : s))
    try {
      const res = await fetch('/api/users/me/strategies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy_key: key, paper_enabled: !current }),
      })
      if (!res.ok) {
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
    setLastRun(null)
    try {
      const res = await fetch('/api/paper-trading/run', { method: 'POST' })
      const result = await res.json() as PaperRunResult & { error?: string }

      if (result.error) {
        setRunMsg({ text: result.error, ok: false })
      } else if (result.errors?.length > 0 && result.strategiesRun === 0) {
        setRunMsg({ text: result.errors[0], ok: false })
      } else {
        setLastRun(result)
        setRunMsg({ text: buildRunSummary(result), ok: true })
      }
      await loadPositions()
    } finally {
      setRunning(false)
    }
  }

  const visibleStrategies = userProfileKey
    ? strategies.filter(s => s.enabledInProfiles?.includes(userProfileKey) ?? true)
    : strategies
  const hiddenCount = strategies.length - visibleStrategies.length
  const enabledCount = visibleStrategies.filter(s => s.paperEnabled).length
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
          {/* Profile filter banner */}
          {userProfileKey && hiddenCount > 0 && (
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-400 flex items-center justify-between">
              <span>
                Showing <strong className="text-white">{visibleStrategies.length}</strong> of {strategies.length} strategies available in your{' '}
                <strong className="text-white capitalize">{userProfileKey}</strong> profile.
              </span>
              <a href="/settings/risk-profile" className="text-indigo-400 hover:text-indigo-300 shrink-0 ml-2">
                Change profile →
              </a>
            </div>
          )}

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
              {visibleStrategies.map(s => (
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
              {visibleStrategies.length === 0 && strategies.length === 0 && (
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

          {/* Plain-English explanation */}
          {lastRun && (
            <p className="text-xs text-gray-500 px-0.5">{plainEnglishSummary(lastRun)}</p>
          )}

          {/* Skip breakdown drawer */}
          {lastRun && (
            <SkipBreakdown skipped={lastRun.skipped} details={lastRun.skippedDetails} />
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
