'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { Activity, TrendingUp, TrendingDown, RefreshCw, Users } from 'lucide-react'
import Link from 'next/link'

interface FeedTrade {
  id: string
  trader_id: string
  asset_class: string
  symbol: string
  action: 'buy' | 'sell' | 'short' | 'cover'
  quantity?: number
  price?: number
  notional_value?: number
  trade_date: string
  traders?: { id: string; name: string; handle: string; asset_class: string; avatar_url?: string }
}

interface Props {
  initialTrades: unknown[]
  followedTraderIds: string[]
  userId: string
  hasFollows: boolean
}

const ACTION_CONFIG = {
  buy:   { label: 'BUY',   classes: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' },
  sell:  { label: 'SELL',  classes: 'bg-red-500/10 text-red-400 border border-red-500/20' },
  short: { label: 'SHORT', classes: 'bg-orange-500/10 text-orange-400 border border-orange-500/20' },
  cover: { label: 'COVER', classes: 'bg-blue-500/10 text-blue-400 border border-blue-500/20' },
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function FeedClient({ initialTrades, followedTraderIds, userId, hasFollows }: Props) {
  const [trades, setTrades] = useState<FeedTrade[]>(initialTrades as FeedTrade[])
  const [newCount, setNewCount] = useState(0)

  useEffect(() => {
    if (!hasFollows) return

    const supabase = createClient()
    const followedSet = new Set(followedTraderIds)

    const channel = supabase
      .channel('feed-updates')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trader_trades' },
        async (payload) => {
          const trade = payload.new as FeedTrade
          if (!followedSet.has(trade.trader_id)) return

          // Fetch trader details
          const { data: trader } = await supabase
            .from('traders')
            .select('id, name, handle, asset_class, avatar_url')
            .eq('id', trade.trader_id)
            .single()

          const enriched = { ...trade, traders: trader ?? undefined }
          setTrades(prev => [enriched, ...prev].slice(0, 100))
          setNewCount(c => c + 1)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFollows, followedTraderIds.join(',')])

  if (!hasFollows) {
    return (
      <div className="rounded-xl border border-dashed border-white/20 p-12 text-center">
        <Users className="h-10 w-10 text-gray-600 mx-auto mb-3" />
        <p className="text-sm text-gray-400">No traders followed yet</p>
        <p className="text-xs text-gray-600 mt-1">
          <Link href="/traders" className="text-indigo-400 hover:underline">Browse traders</Link> and follow some to see their trades here
        </p>
      </div>
    )
  }

  if (trades.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/20 p-12 text-center">
        <Activity className="h-10 w-10 text-gray-600 mx-auto mb-3" />
        <p className="text-sm text-gray-400">No trades yet from followed traders</p>
        <p className="text-xs text-gray-600 mt-1">New trades will appear here in real-time</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {newCount > 0 && (
        <button
          onClick={() => setNewCount(0)}
          className="w-full rounded-lg bg-indigo-600/20 border border-indigo-500/30 py-2.5 text-xs font-medium text-indigo-400 flex items-center justify-center gap-2 hover:bg-indigo-600/30 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {newCount} new trade{newCount > 1 ? 's' : ''} — click to dismiss
        </button>
      )}

      {trades.map(trade => {
        const cfg = ACTION_CONFIG[trade.action] ?? ACTION_CONFIG.buy
        const isBullish = trade.action === 'buy' || trade.action === 'cover'

        return (
          <Card key={trade.id}>
            <div className="flex items-start gap-4 p-4">
              {/* Avatar */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600/20 text-indigo-300 text-sm font-bold">
                {(trade.traders?.name ?? '?')[0]}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-white">{trade.traders?.name ?? 'Unknown'}</span>
                  <span className="text-xs text-gray-500">@{trade.traders?.handle ?? '—'}</span>
                  <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${cfg.classes}`}>{cfg.label}</span>
                  <span className="font-mono text-sm font-bold text-indigo-300">{trade.symbol}</span>
                </div>

                <div className="flex items-center gap-4 mt-1.5 text-xs text-gray-500">
                  {trade.notional_value && (
                    <span className="flex items-center gap-1">
                      {isBullish ? <TrendingUp className="h-3 w-3 text-emerald-400" /> : <TrendingDown className="h-3 w-3 text-red-400" />}
                      {formatCurrency(trade.notional_value)}
                    </span>
                  )}
                  {trade.price && <span>@ ${trade.price.toFixed(2)}</span>}
                  {trade.quantity && <span>{trade.quantity.toLocaleString()} shares</span>}
                  <span className="capitalize">{trade.asset_class}</span>
                  <span className="ml-auto">{timeAgo(trade.trade_date)}</span>
                </div>
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
