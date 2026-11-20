'use client'

/**
 * Explore / Top Traders (Phase 4.4 guardrails):
 *  - Explore limit card: meter, dollars in use, dollars left, limit percent.
 *  - Every trader shows "Their result" AND "What a copier got" (emphasized),
 *    labeled, with a line explaining the gap; swings pill instead of jargon.
 *  - A follower in a practice run sees "day N of 30"; auto-copy unlocks when
 *    the run finishes.
 *  - Simple mode: following requires approving a plain-language summary
 *    (recorded server-side), and ranking is risk/delay-adjusted, never raw.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { followTrader, unfollowTrader } from '@/lib/actions/traders'
import { updateExploreCap } from '@/lib/actions/explore'
import type { ExploreView, ExploreTrader } from '@/lib/actions/explore'
import type { Trader } from '@/lib/types'
import {
  Users, RefreshCw, Zap, CheckCircle2, AlertCircle, Star, BarChart2, Info,
} from 'lucide-react'

const ASSET_TABS = [
  { key: 'all', label: 'All Traders' },
  { key: 'stock', label: 'Stocks' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'forex', label: 'Forex' },
  { key: 'polymarket', label: 'Polymarket' },
] as const

const SOURCE_LABELS: Record<string, string> = {
  unusual_whales: 'Unusual Whales',
  quiver_quant: 'Quiver Quant',
  nansen: 'Nansen',
  arkham: 'Arkham',
  myfxbook: 'MyFxBook',
  polymarket: 'Polymarket',
  manual: 'Manual',
}

const ASSET_CLASS_COLORS: Record<string, string> = {
  stock: 'text-indigo-400 bg-indigo-500/10',
  crypto: 'text-amber-400 bg-amber-500/10',
  forex: 'text-emerald-400 bg-emerald-500/10',
  polymarket: 'text-purple-400 bg-purple-500/10',
}

function Pct({ pct, emphasized }: { pct: number; emphasized?: boolean }) {
  const positive = pct >= 0
  return (
    <span className={`font-mono text-sm font-bold ${emphasized ? (positive ? 'text-emerald-300' : 'text-orange-300') : 'text-text-1'}`}>
      <span aria-hidden>{positive ? '▲' : '▼'}</span> {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

function usd(n: number): string {
  return `$${Math.round(Math.abs(n)).toLocaleString()}`
}

// ─── Explore limit card ───────────────────────────────────────────────────────

function ExploreLimitCard({ view }: { view: ExploreView }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pct, setPct] = useState(Math.round(view.usage.capFraction * 100))
  const [err, setErr] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const { usage } = view
  const usedFraction = usage.capUsd > 0 ? Math.min(1, usage.usedUsd / usage.capUsd) : 0

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-sm font-semibold text-white">Explore limit</p>
        <p className="text-xs text-text-1">{Math.round(usage.capFraction * 100)}% of money outside Safety</p>
      </div>
      <div
        role="progressbar"
        aria-label={`${usd(usage.usedUsd)} of your ${usd(usage.capUsd)} Explore limit in use`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usedFraction * 100)}
        className="mt-3 h-2.5 rounded-full bg-fill"
      >
        <div className="h-2.5 rounded-full bg-purple-400" style={{ width: `${usedFraction * 100}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-text-1">
        <span><span className="font-mono text-white">{usd(usage.usedUsd)}</span> in use</span>
        <span><span className="font-mono text-white">{usd(usage.leftUsd)}</span> left</span>
      </div>
      {usage.totalValueUsd <= 0 ? (
        <p className="mt-2 text-xs text-orange-300">
          No recorded portfolio value yet — the Explore limit is $0 until your assets are recorded.
        </p>
      ) : !usage.tier1Funded && usage.closedReason ? (
        <p role="alert" className="mt-2 text-xs text-orange-300">
          {usage.closedReason} <Link href="/advisor" className="underline">Open your money ladder</Link>
        </p>
      ) : null}
      {view.uiMode === 'pro' && (
        <div className="mt-3 border-t border-line-strong pt-3">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                type="number" min={1} max={Math.round(view.hardMaxFraction * 100)} value={pct}
                onChange={e => setPct(Number(e.target.value))}
                aria-label="Explore limit percent"
                className="w-20 rounded-lg border border-line-strong bg-white/5 px-2 py-1 text-sm text-white"
              />
              <span className="text-xs text-gray-500">% (hard max {Math.round(view.hardMaxFraction * 100)}%)</span>
              <Button size="sm" disabled={isPending} onClick={() => startTransition(async () => {
                setErr(null)
                const res = await updateExploreCap(pct / 100)
                if (!res.ok) setErr(res.error ?? 'failed')
                else { setEditing(false); router.refresh() }
              })}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          ) : (
            <button onClick={() => setEditing(true)} className="text-xs text-text-1 underline hover:text-white">
              Adjust limit (pro)
            </button>
          )}
          {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
        </div>
      )}
    </Card>
  )
}

// ─── Follow approval modal (simple mode) ─────────────────────────────────────

function followSummary(t: Trader): string {
  return `Follow ${t.name} with practice money. Their trades will be copied into your Explore sleeve, ` +
    `sized within your limits, never touching your core portfolio. Nothing is copied with real money, ` +
    `and auto-copy stays off until a 30-day practice run finishes and you approve it separately.`
}

function ApprovalModal({ trader, busy, error, onApprove, onCancel }: {
  trader: Trader
  busy: boolean
  error: string | null
  onApprove: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-white/15 bg-bg-1 p-5">
        <h3 className="text-sm font-bold text-white">Before anything starts</h3>
        <p className="mt-3 text-sm leading-relaxed text-gray-300">{followSummary(trader)}</p>
        {error && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-950/30 p-2 text-xs text-red-300">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy}
            className="rounded-lg border border-line-strong px-4 py-2 text-xs text-gray-300 hover:bg-white/5 disabled:opacity-40">
            Not now
          </button>
          <button onClick={onApprove} disabled={busy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40">
            {busy ? 'Recording…' : 'I understand — follow'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Trader card ─────────────────────────────────────────────────────────────

function TraderCard({ item, onToggleFollow }: {
  item: ExploreTrader & { optimisticFollowing?: boolean }
  onToggleFollow: (t: Trader) => void
}) {
  const trader = item.trader
  const isFollowing = item.optimisticFollowing ?? !!trader.follow_settings
  const initials = trader.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const assetColorClass = ASSET_CLASS_COLORS[trader.asset_class] ?? 'text-text-1 bg-fill'
  const inPracticeRun = isFollowing && item.practiceRun && !item.practiceRun.complete

  return (
    <Card className="group hover:border-white/20 transition-all">
      <div className="flex items-start gap-4">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-bold ${assetColorClass}`}>
          {initials}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white">{trader.name}</span>
            {trader.verified && <CheckCircle2 className="h-3.5 w-3.5 text-indigo-400 shrink-0" />}
            <span className="text-xs text-gray-500">@{trader.handle}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              item.swing === 'bigger' ? 'bg-orange-500/15 text-orange-300' : 'bg-fill text-gray-300'
            }`}>
              {item.swing === 'bigger' ? 'Bigger swings' : 'Lower swings'}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${assetColorClass}`}>
              {trader.asset_class}
            </span>
            <span className="rounded-md px-1.5 py-0.5 text-xs font-medium bg-white/5 text-text-1">
              {SOURCE_LABELS[trader.source] ?? trader.source}
            </span>
          </div>
          {trader.bio && (
            <p className="mt-1.5 text-xs text-gray-500 leading-relaxed line-clamp-2">{trader.bio}</p>
          )}
        </div>

        <button
          onClick={() => onToggleFollow(trader)}
          className={`shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
            isFollowing
              ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30'
              : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`}
        >
          {isFollowing ? (
            <><CheckCircle2 className="h-3 w-3" /> Following</>
          ) : (
            <><Star className="h-3 w-3" /> Try with practice money</>
          )}
        </button>
      </div>

      {/* 4.4: labeled headline vs copier-adjusted result, copier emphasized */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-white/5 p-3">
          <p className="text-xs text-gray-500">Their result (headline)</p>
          <Pct pct={item.copier.headlinePct} />
        </div>
        <div className="rounded-xl border border-cyan-500/25 bg-white/5 p-3">
          <p className="text-xs text-cyan-300">What a copier got{item.copier.isEstimate ? ' (estimate)' : ''}</p>
          <Pct pct={item.copier.copierPct} emphasized />
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-gray-500">{item.copier.explanation}</p>

      {/* Practice run progress */}
      {inPracticeRun && item.practiceRun && (
        <div className="mt-3 rounded-xl bg-amber-500/5 border border-amber-500/20 p-3">
          <div className="flex justify-between text-xs">
            <span className="text-amber-300">Practice run: day {item.practiceRun.dayN} of {item.practiceRun.totalDays}</span>
          </div>
          <div
            role="progressbar"
            aria-label={`Practice run day ${item.practiceRun.dayN} of ${item.practiceRun.totalDays}`}
            aria-valuemin={0} aria-valuemax={item.practiceRun.totalDays} aria-valuenow={item.practiceRun.dayN}
            className="mt-2 h-1.5 rounded-full bg-fill"
          >
            <div className="h-1.5 rounded-full bg-amber-400" style={{ width: `${(item.practiceRun.dayN / item.practiceRun.totalDays) * 100}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-gray-500">Auto-copy unlocks when the practice run finishes.</p>
        </div>
      )}

      {isFollowing && trader.follow_settings && (
        <div className="mt-3 flex items-center gap-2">
          <Zap className={`h-3.5 w-3.5 ${trader.follow_settings.auto_copy_enabled ? 'text-amber-400' : 'text-gray-600'}`} />
          <span className="text-xs text-text-1">
            {trader.follow_settings.auto_copy_enabled
              ? `Auto-copy ON · max ${trader.follow_settings.max_allocation_pct_per_trade}% per trade`
              : item.autoCopyUnlocked
                ? 'Auto-copy OFF — configure in Autopilot'
                : 'Auto-copy locked until the practice run finishes'}
          </span>
        </div>
      )}
    </Card>
  )
}

// ─── Page client ─────────────────────────────────────────────────────────────

interface Props { view: ExploreView }

export function TradersClient({ view }: Props) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<string>('all')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const [optimisticFollows, setOptimisticFollows] = useState<Record<string, boolean>>({})
  const [approving, setApproving] = useState<Trader | null>(null)
  const [approveBusy, setApproveBusy] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)

  const traders = view.traders
  const filtered = activeTab === 'all' ? traders : traders.filter(t => t.trader.asset_class === activeTab)

  const totalFollowing = traders.filter(t => t.trader.follow_settings).length
  const totalAutoCopy = traders.filter(t => t.trader.follow_settings?.auto_copy_enabled).length

  async function handleSync() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: ['all'] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSyncMsg(`Synced ${data.results?.demo_traders ?? 0} traders`)
      router.refresh()
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  function doFollow(trader: Trader, approvedSummary?: string) {
    setOptimisticFollows(prev => ({ ...prev, [trader.id]: true }))
    startTransition(async () => {
      const res = await followTrader(trader.id, approvedSummary ? { summary: approvedSummary } : undefined)
      if (res?.error) {
        setOptimisticFollows(prev => ({ ...prev, [trader.id]: false }))
        setApproveError(res.error)
      } else {
        setApproving(null)
      }
      setApproveBusy(false)
      router.refresh()
    })
  }

  function handleToggleFollow(trader: Trader) {
    const isFollowing = optimisticFollows[trader.id] ?? !!trader.follow_settings
    if (isFollowing) {
      setOptimisticFollows(prev => ({ ...prev, [trader.id]: false }))
      startTransition(async () => {
        await unfollowTrader(trader.id)
        router.refresh()
      })
      return
    }
    // 4.3: simple mode shows the plain-language summary and requires approval.
    if (view.uiMode === 'simple') {
      setApproveError(null)
      setApproving(trader)
      return
    }
    doFollow(trader)
  }

  const needsSync = traders.length === 0

  return (
    <div className="p-6 space-y-6">
      {/* Explore limit (Phase 4.2) */}
      <ExploreLimitCard view={view} />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Traders</p>
          <p className="mt-2 text-2xl font-bold text-white">{traders.length}</p>
          <p className="mt-1 text-xs text-gray-500">across 4 asset classes</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Following</p>
          <p className="mt-2 text-2xl font-bold text-indigo-400">{totalFollowing}</p>
          <p className="mt-1 text-xs text-gray-500">traders in your feed</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Auto-Copy Active</p>
          <p className="mt-2 text-2xl font-bold text-amber-400">{totalAutoCopy}</p>
          <p className="mt-1 text-xs text-gray-500">unlocked after a 30-day practice run</p>
        </Card>
      </div>

      {/* Sync banner */}
      {needsSync && (
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 flex items-start gap-3">
          <Info className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-indigo-400">No traders loaded yet</p>
            <p className="text-xs text-text-1 mt-1">
              Run the sync to populate traders from all data sources.
              Add API keys in your environment variables to enable live data.
            </p>
          </div>
          <Button size="sm" onClick={handleSync} disabled={syncing}>
            {syncing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : 'Sync Now'}
          </Button>
        </div>
      )}

      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1">
          {ASSET_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-indigo-600 text-white'
                  : 'text-text-1 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {view.uiMode === 'simple' && (
            <span className="text-xs text-gray-500">Sorted by what a copier actually keeps, adjusted for swings</span>
          )}
          {syncMsg && <span className="text-xs text-text-1">{syncMsg}</span>}
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
            Sync
          </Button>
        </div>
      </div>

      {/* Trader grid */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/20 p-12 text-center">
          <BarChart2 className="h-10 w-10 text-gray-600 mx-auto mb-3" />
          <p className="text-sm text-text-1">No traders found for this filter</p>
          <p className="text-xs text-gray-600 mt-1">Try syncing or switching to a different asset class</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map(item => (
            <TraderCard
              key={item.trader.id}
              item={{
                ...item,
                optimisticFollowing: optimisticFollows[item.trader.id] ?? !!item.trader.follow_settings,
              }}
              onToggleFollow={handleToggleFollow}
            />
          ))}
        </div>
      )}

      {/* 4.3: approval before anything starts (simple mode) */}
      {approving && (
        <ApprovalModal
          trader={approving}
          busy={approveBusy}
          error={approveError}
          onApprove={() => { setApproveBusy(true); doFollow(approving, followSummary(approving)) }}
          onCancel={() => { setApproving(null); setApproveError(null) }}
        />
      )}

      {/* Disclaimer */}
      <div className="rounded-xl border border-line-strong bg-white/5 p-4 flex items-start gap-3">
        <AlertCircle className="h-4 w-4 text-gray-500 shrink-0 mt-0.5" />
        <p className="text-xs text-gray-500 leading-relaxed">
          Copy trading involves significant risk. Past performance of tracked traders does not guarantee future results.
          Copying runs on practice money during the paper phase; auto-copy with real money stays locked until live trading
          is ever enabled, a 30-day practice run finishes, and you approve it. Never copy more than you can afford to lose.
          This is not financial advice.
        </p>
      </div>
    </div>
  )
}
