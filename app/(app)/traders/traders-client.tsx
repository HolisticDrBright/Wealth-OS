'use client'

import { useState, useTransition, useOptimistic } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { followTrader, unfollowTrader } from '@/lib/actions/traders'
import type { Trader } from '@/lib/types'
import {
  TrendingUp, TrendingDown, Users, RefreshCw, Zap,
  CheckCircle2, AlertCircle, Star, BarChart2, Info,
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

function ReturnBadge({ pct }: { pct: number }) {
  const positive = pct >= 0
  return (
    <span className={`flex items-center gap-0.5 text-sm font-bold ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
      {positive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {positive ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}

function TraderCard({ trader, onToggleFollow }: {
  trader: Trader & { optimisticFollowing?: boolean }
  onToggleFollow: (t: Trader) => void
}) {
  const isFollowing = trader.optimisticFollowing ?? !!trader.follow_settings
  const initials = trader.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  const assetColorClass = ASSET_CLASS_COLORS[trader.asset_class] ?? 'text-gray-400 bg-white/10'

  return (
    <Card className="group hover:border-white/20 transition-all">
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-bold ${assetColorClass}`}>
          {initials}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white">{trader.name}</span>
            {trader.verified && <CheckCircle2 className="h-3.5 w-3.5 text-indigo-400 shrink-0" />}
            <span className="text-xs text-gray-500">@{trader.handle}</span>
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${assetColorClass}`}>
              {trader.asset_class}
            </span>
            <span className="rounded-md px-1.5 py-0.5 text-xs font-medium bg-white/5 text-gray-400">
              {SOURCE_LABELS[trader.source] ?? trader.source}
            </span>
          </div>
          {trader.bio && (
            <p className="mt-1.5 text-xs text-gray-500 leading-relaxed line-clamp-2">{trader.bio}</p>
          )}
        </div>

        {/* Follow button */}
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
            <><Star className="h-3 w-3" /> Follow</>
          )}
        </button>
      </div>

      {/* Stats row */}
      <div className="mt-4 grid grid-cols-4 gap-3 rounded-xl bg-white/5 p-3">
        <div className="text-center">
          <p className="text-xs text-gray-500">30d Return</p>
          <ReturnBadge pct={trader.total_return_pct} />
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-500">Win Rate</p>
          <p className="text-sm font-bold text-white">{trader.win_rate_pct}%</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-500">Trades/mo</p>
          <p className="text-sm font-bold text-white">{trader.trade_count}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-gray-500">Followers</p>
          <p className="text-sm font-bold text-white">{trader.followers_count.toLocaleString()}</p>
        </div>
      </div>

      {/* Auto-copy chip if following */}
      {isFollowing && trader.follow_settings && (
        <div className="mt-3 flex items-center gap-2">
          <Zap className={`h-3.5 w-3.5 ${trader.follow_settings.auto_copy_enabled ? 'text-amber-400' : 'text-gray-600'}`} />
          <span className="text-xs text-gray-400">
            {trader.follow_settings.auto_copy_enabled
              ? `Auto-copy ON · max ${trader.follow_settings.max_allocation_pct_per_trade}% per trade`
              : 'Auto-copy OFF — configure in Autopilot'}
          </span>
        </div>
      )}
    </Card>
  )
}

interface Props { traders: Trader[] }

export function TradersClient({ traders }: Props) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<string>('all')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [optimisticFollows, setOptimisticFollows] = useState<Record<string, boolean>>({})

  const filtered = activeTab === 'all' ? traders : traders.filter(t => t.asset_class === activeTab)

  const totalFollowing = traders.filter(t => t.follow_settings).length
  const totalAutoCopy = traders.filter(t => t.follow_settings?.auto_copy_enabled).length

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

  function handleToggleFollow(trader: Trader) {
    const isFollowing = optimisticFollows[trader.id] ?? !!trader.follow_settings
    setOptimisticFollows(prev => ({ ...prev, [trader.id]: !isFollowing }))
    startTransition(async () => {
      if (isFollowing) {
        await unfollowTrader(trader.id)
      } else {
        await followTrader(trader.id)
      }
      router.refresh()
    })
  }

  const needsSync = traders.length === 0

  return (
    <div className="p-6 space-y-6">
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
          <p className="mt-1 text-xs text-gray-500">set up in Autopilot</p>
        </Card>
      </div>

      {/* Sync banner */}
      {needsSync && (
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 flex items-start gap-3">
          <Info className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-indigo-400">No traders loaded yet</p>
            <p className="text-xs text-gray-400 mt-1">
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
        {/* Tabs */}
        <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1">
          {ASSET_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {syncMsg && (
            <span className="text-xs text-gray-400">{syncMsg}</span>
          )}
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
          <p className="text-sm text-gray-400">No traders found for this filter</p>
          <p className="text-xs text-gray-600 mt-1">Try syncing or switching to a different asset class</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map(trader => (
            <TraderCard
              key={trader.id}
              trader={{
                ...trader,
                optimisticFollowing: optimisticFollows[trader.id] ?? !!trader.follow_settings,
              }}
              onToggleFollow={handleToggleFollow}
            />
          ))}
        </div>
      )}

      {/* Disclaimer */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-start gap-3">
        <AlertCircle className="h-4 w-4 text-gray-500 shrink-0 mt-0.5" />
        <p className="text-xs text-gray-500 leading-relaxed">
          Copy trading involves significant risk. Past performance of tracked traders does not guarantee future results.
          Auto-copy executes real orders using your connected broker accounts. Never copy more than you can afford to lose.
          This is not financial advice. Configure broker API keys and risk limits in Autopilot before enabling auto-copy.
        </p>
      </div>
    </div>
  )
}
