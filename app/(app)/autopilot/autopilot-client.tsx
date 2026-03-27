'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { formatCurrency } from '@/lib/utils'
import { updateCopySettings, unfollowTrader } from '@/lib/actions/traders'
import { CIODecisionModal } from '@/components/agents/cio-decision-modal'
import type { UserCopiedPosition } from '@/lib/types'
import type { TradeContext } from '@/lib/agents/types'
import {
  Zap, ZapOff, TrendingUp, TrendingDown, RefreshCw,
  Settings2, Trash2, AlertCircle, CheckCircle2, Clock,
  XCircle, DollarSign, BarChart2, Brain,
} from 'lucide-react'

interface FollowedTrader {
  id: string
  trader_id: string
  auto_copy_enabled: boolean
  max_allocation_pct_per_trade: number
  risk_level: string
  max_daily_copy_usd: number | null
  copy_asset_classes: string[]
  traders: {
    id: string
    name: string
    handle: string
    asset_class: string
    total_return_pct: number
    win_rate_pct: number
  }
}

interface Props {
  followedTraders: FollowedTrader[]
  positions: UserCopiedPosition[]
}

const STATUS_ICONS = {
  pending: <Clock className="h-3.5 w-3.5 text-amber-400" />,
  open: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
  closed: <XCircle className="h-3.5 w-3.5 text-gray-400" />,
  failed: <AlertCircle className="h-3.5 w-3.5 text-red-400" />,
}

function TraderSettingsRow({ follow, onSaved }: {
  follow: FollowedTrader
  onSaved: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [autoCopy, setAutoCopy] = useState(follow.auto_copy_enabled)
  const [maxPct, setMaxPct] = useState(String(follow.max_allocation_pct_per_trade))
  const [riskLevel, setRiskLevel] = useState(follow.risk_level)
  const [maxDaily, setMaxDaily] = useState(follow.max_daily_copy_usd ? String(follow.max_daily_copy_usd) : '')
  const [isPending, startTransition] = useTransition()

  const trader = follow.traders
  const positive = trader.total_return_pct >= 0

  function save() {
    startTransition(async () => {
      await updateCopySettings(follow.trader_id, {
        auto_copy_enabled: autoCopy,
        max_allocation_pct_per_trade: Number(maxPct),
        risk_level: riskLevel,
        max_daily_copy_usd: maxDaily ? Number(maxDaily) : null,
      })
      onSaved()
    })
  }

  async function toggleAutoCopy() {
    const next = !autoCopy
    setAutoCopy(next)
    await updateCopySettings(follow.trader_id, { auto_copy_enabled: next })
    onSaved()
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      <div className="flex items-center gap-4 p-4">
        {/* Trader info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white text-sm">{trader.name}</span>
            <span className="text-xs text-gray-500">@{trader.handle}</span>
            <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${
              trader.asset_class === 'stock' ? 'bg-indigo-500/10 text-indigo-400' :
              trader.asset_class === 'crypto' ? 'bg-amber-500/10 text-amber-400' :
              trader.asset_class === 'forex' ? 'bg-emerald-500/10 text-emerald-400' :
              'bg-purple-500/10 text-purple-400'
            }`}>{trader.asset_class}</span>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className={`text-xs font-medium ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
              {positive ? '+' : ''}{trader.total_return_pct.toFixed(1)}% 30d
            </span>
            <span className="text-xs text-gray-500">{trader.win_rate_pct}% win rate</span>
          </div>
        </div>

        {/* Auto-copy toggle */}
        <div className="flex items-center gap-3">
          <button
            onClick={toggleAutoCopy}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              autoCopy
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'bg-white/5 text-gray-400 border border-white/10 hover:text-white'
            }`}
          >
            {autoCopy ? <Zap className="h-3.5 w-3.5" /> : <ZapOff className="h-3.5 w-3.5" />}
            {autoCopy ? 'Auto-Copy ON' : 'Auto-Copy OFF'}
          </button>
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {expanded && (
        <div className="border-t border-white/10 p-4 space-y-4 bg-white/[0.02]">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              label="Max allocation per trade (%)"
              type="number"
              min="1"
              max="25"
              value={maxPct}
              onChange={e => setMaxPct(e.target.value)}
            />
            <Select
              label="Risk level"
              value={riskLevel}
              onChange={e => setRiskLevel(e.target.value)}
              options={[
                { value: 'conservative', label: 'Conservative (smaller sizes)' },
                { value: 'moderate', label: 'Moderate' },
                { value: 'aggressive', label: 'Aggressive (full sizes)' },
              ]}
            />
            <Input
              label="Max daily spend ($, optional)"
              type="number"
              min="0"
              value={maxDaily}
              onChange={e => setMaxDaily(e.target.value)}
              placeholder="No limit"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={save} disabled={isPending}>
              {isPending ? 'Saving...' : 'Save Settings'}
            </Button>
            <UnfollowButton traderId={follow.trader_id} onDone={onSaved} />
          </div>
        </div>
      )}
    </div>
  )
}

function UnfollowButton({ traderId, onDone }: { traderId: string; onDone: () => void }) {
  const [isPending, startTransition] = useTransition()
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={isPending}
      onClick={() => startTransition(async () => {
        await unfollowTrader(traderId)
        onDone()
      })}
    >
      <Trash2 className="h-3.5 w-3.5 mr-1.5 text-red-400" />
      Unfollow
    </Button>
  )
}

export function AutopilotClient({ followedTraders, positions: initialPositions }: Props) {
  const router = useRouter()
  const [executing, setExecuting] = useState(false)
  const [execMsg, setExecMsg] = useState<string | null>(null)
  const [cioModal, setCioModal] = useState<{ open: boolean; context: TradeContext | null }>({ open: false, context: null })
  const [positions, setPositions] = useState(initialPositions)

  // ─── Realtime: portfolio-updates ─────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('portfolio-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'user_copied_positions' },
        (payload) => {
          const updated = payload.new as UserCopiedPosition
          setPositions(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p))
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_copied_positions' },
        (payload) => {
          const newPos = payload.new as UserCopiedPosition
          setPositions(prev => [newPos, ...prev])
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  function openCIOAnalysis(position: UserCopiedPosition) {
    const context: TradeContext = {
      trade: {
        symbol: position.symbol,
        action: position.action as TradeContext['trade']['action'],
        asset_class: position.asset_class as TradeContext['trade']['asset_class'],
        notional_value: position.notional_value,
        trader_name: position.trader?.name ?? 'Unknown',
        trader_handle: position.trader?.handle ?? '',
        trader_return_pct: 0,
        trader_win_rate: 0,
      },
      user: {
        id: 'current',
        total_net_worth: positions.reduce((s, p) => s + p.notional_value, 0),
        portfolio: [],
      },
    }
    setCioModal({ open: true, context })
  }

  const autoCopyCount = followedTraders.filter(f => f.auto_copy_enabled).length
  const openPositions = positions.filter(p => p.status === 'open')
  const totalPnl = openPositions.reduce((s, p) => s + (p.pnl_usd ?? 0), 0)
  const totalNotional = openPositions.reduce((s, p) => s + (p.notional_value ?? 0), 0)

  async function runCopyEngine() {
    setExecuting(true)
    setExecMsg(null)
    try {
      const res = await fetch('/api/execute-copy-trades', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setExecMsg(data.executed > 0
        ? `Executed ${data.executed} new copy trade${data.executed > 1 ? 's' : ''}`
        : 'No new trades to copy right now')
      router.refresh()
    } catch (err) {
      setExecMsg(err instanceof Error ? err.message : 'Failed to run copy engine')
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Following</p>
          <p className="mt-2 text-2xl font-bold text-white">{followedTraders.length}</p>
          <p className="mt-1 text-xs text-gray-500">traders tracked</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Auto-Copy Active</p>
          <p className="mt-2 text-2xl font-bold text-amber-400">{autoCopyCount}</p>
          <p className="mt-1 text-xs text-gray-500">autopilot enabled</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Open Positions</p>
          <p className="mt-2 text-2xl font-bold text-indigo-400">{openPositions.length}</p>
          <p className="mt-1 text-xs text-gray-500">{formatCurrency(totalNotional)} deployed</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total P&L</p>
          <p className={`mt-2 text-2xl font-bold ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalPnl >= 0 ? '+' : ''}{formatCurrency(totalPnl)}
          </p>
          <p className="mt-1 text-xs text-gray-500">on open positions</p>
        </Card>
      </div>

      {/* Broker config notice */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-400">Connect your broker to enable live execution</p>
          <p className="text-xs text-gray-400 mt-1">
            Add <code className="bg-white/10 px-1 rounded">ALPACA_API_KEY</code> + <code className="bg-white/10 px-1 rounded">ALPACA_SECRET_KEY</code> for stocks,
            {' '}<code className="bg-white/10 px-1 rounded">BINANCE_API_KEY</code> for crypto,
            {' '}<code className="bg-white/10 px-1 rounded">OANDA_API_KEY</code> for forex.
            Paper trading is active by default (Alpaca paper endpoint).
          </p>
        </div>
      </div>

      {/* Followed Traders + Settings */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Followed Traders</h2>
          <div className="flex items-center gap-2">
            {execMsg && <span className="text-xs text-gray-400">{execMsg}</span>}
            <Button size="sm" onClick={runCopyEngine} disabled={executing}>
              {executing
                ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Running...</>
                : <><Zap className="h-3.5 w-3.5 mr-1.5" />Run Copy Engine</>
              }
            </Button>
          </div>
        </div>

        {followedTraders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/20 p-10 text-center">
            <Zap className="h-10 w-10 text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No traders followed yet</p>
            <p className="text-xs text-gray-600 mt-1">Go to Top Traders and follow traders you want to copy</p>
          </div>
        ) : (
          <div className="space-y-3">
            {followedTraders.map(f => (
              <TraderSettingsRow key={f.id} follow={f} onSaved={() => router.refresh()} />
            ))}
          </div>
        )}
      </div>

      {/* Positions table */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Copied Positions</h2>

        {positions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/20 p-10 text-center">
            <BarChart2 className="h-10 w-10 text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No copied positions yet</p>
            <p className="text-xs text-gray-600 mt-1">Enable auto-copy on a trader and run the copy engine</p>
          </div>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    {['Trader', 'Symbol', 'Action', 'Size', 'P&L', 'Status', 'Broker', 'Date', 'Analysis'].map(h => (
                      <th key={h} className="pb-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider pr-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {positions.map(p => (
                    <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 pr-4 text-white font-medium">{p.trader?.name ?? '—'}</td>
                      <td className="py-3 pr-4 font-mono text-indigo-300">{p.symbol}</td>
                      <td className="py-3 pr-4">
                        <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                          p.action === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                        }`}>{p.action.toUpperCase()}</span>
                      </td>
                      <td className="py-3 pr-4 text-white">{formatCurrency(p.notional_value)}</td>
                      <td className="py-3 pr-4">
                        <span className={`font-semibold ${p.pnl_usd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {p.pnl_usd >= 0 ? '+' : ''}{formatCurrency(p.pnl_usd)}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-1.5">
                          {STATUS_ICONS[p.status]}
                          <span className="text-xs text-gray-400 capitalize">{p.status}</span>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-xs text-gray-500 capitalize">{p.broker ?? '—'}</td>
                      <td className="py-3 text-xs text-gray-500">
                        {new Date(p.opened_at).toLocaleDateString()}
                      </td>
                      <td className="py-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openCIOAnalysis(p)}
                          className="h-7 px-2 text-xs gap-1.5"
                        >
                          <Brain className="h-3.5 w-3.5 text-indigo-400" />
                          Analyze
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* CIO Decision Modal */}
      {cioModal.open && cioModal.context && (
        <CIODecisionModal
          open={cioModal.open}
          onClose={() => setCioModal({ open: false, context: null })}
          tradeContext={cioModal.context}
        />
      )}

      {/* Disclaimer */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-start gap-3">
        <AlertCircle className="h-4 w-4 text-gray-500 shrink-0 mt-0.5" />
        <p className="text-xs text-gray-500 leading-relaxed">
          Auto-copy executes real trades using your connected broker API keys. Wealth OS is not a licensed broker or investment advisor.
          You are solely responsible for all trading activity. Always use risk limits and never risk more than you can afford to lose.
        </p>
      </div>
    </div>
  )
}
