'use client'

import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { markOpportunityRead } from '@/lib/actions/opportunities'
import type { Opportunity } from '@/lib/types'
import {
  Lightbulb, TrendingUp, TrendingDown, Eye, Search,
  ChevronDown, AlertCircle, CheckCircle2, MinusCircle,
} from 'lucide-react'

interface Props {
  initialOpportunities: Opportunity[]
}

const CONFIDENCE_CONFIG = {
  high:   { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  medium: { icon: MinusCircle,  color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20' },
  low:    { icon: AlertCircle,  color: 'text-gray-400',    bg: 'bg-white/5 border-white/10' },
}

const ACTION_COLOR = {
  buy:   'text-emerald-400 bg-emerald-500/10',
  sell:  'text-red-400 bg-red-500/10',
  watch: 'text-indigo-400 bg-indigo-500/10',
}

export function OpportunitiesClient({ initialOpportunities }: Props) {
  const [opportunities, setOpportunities] = useState(initialOpportunities)
  const [filter, setFilter] = useState<'all' | 'high' | 'unread'>('all')
  const [screenerSymbol, setScreenerSymbol] = useState('')
  const [isScreening, setIsScreening] = useState(false)
  const [screenerError, setScreenerError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const filtered = opportunities.filter(o => {
    if (filter === 'high') return o.confidence === 'high'
    if (filter === 'unread') return !o.is_read
    return true
  })

  function markRead(id: string) {
    startTransition(async () => {
      await markOpportunityRead(id)
      setOpportunities(prev => prev.map(o => o.id === id ? { ...o, is_read: true } : o))
    })
  }

  async function runScreener() {
    if (!screenerSymbol.trim()) return
    setIsScreening(true)
    setScreenerError(null)
    try {
      const res = await fetch('/api/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: screenerSymbol.toUpperCase().trim(), asset_class: 'stock' }),
      })
      const envelope = await res.json()
      if (!res.ok) throw new Error(envelope.error ?? 'Screener failed')
      if (envelope.data) {
        setOpportunities(prev => [envelope.data, ...prev])
        setScreenerSymbol('')
      }
    } catch (err) {
      setScreenerError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsScreening(false)
    }
  }

  const unreadCount = opportunities.filter(o => !o.is_read).length

  return (
    <div className="space-y-4">
      {/* Screener */}
      <Card>
        <div className="p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">AI Screener</p>
          <div className="flex gap-3">
            <Input
              placeholder="Symbol (e.g. AAPL, BTC)"
              value={screenerSymbol}
              onChange={e => setScreenerSymbol(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runScreener()}
              className="flex-1"
            />
            <Button onClick={runScreener} disabled={isScreening || !screenerSymbol.trim()}>
              <Search className="h-4 w-4 mr-2" />
              {isScreening ? 'Analyzing...' : 'Screen'}
            </Button>
          </div>
          {screenerError && (
            <p className="text-xs text-red-400 mt-2">{screenerError}</p>
          )}
        </div>
      </Card>

      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        {(['all', 'high', 'unread'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === f
                ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                : 'text-gray-500 hover:text-white'
            }`}
          >
            {f === 'all' ? `All (${opportunities.length})` : f === 'high' ? 'High Confidence' : `Unread (${unreadCount})`}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/20 p-12 text-center">
          <Lightbulb className="h-10 w-10 text-gray-600 mx-auto mb-3" />
          <p className="text-sm text-gray-400">No opportunities yet</p>
          <p className="text-xs text-gray-600 mt-1">Use the screener above or run the sync worker</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(opp => {
            const conf = CONFIDENCE_CONFIG[opp.confidence ?? 'low']
            const ConfIcon = conf.icon
            return (
              <Card
                key={opp.id}
                className={`transition-opacity ${opp.is_read ? 'opacity-60' : ''}`}
              >
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`rounded-lg border p-2 ${conf.bg}`}>
                      <ConfIcon className={`h-4 w-4 ${conf.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {opp.symbol && (
                          <span className="font-mono text-sm font-bold text-indigo-300">{opp.symbol}</span>
                        )}
                        {opp.action && (
                          <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${ACTION_COLOR[opp.action]}`}>
                            {opp.action.toUpperCase()}
                          </span>
                        )}
                        {opp.score !== undefined && (
                          <span className="text-xs text-gray-500">Score: {Math.round(opp.score)}/100</span>
                        )}
                        {!opp.is_read && (
                          <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
                        )}
                      </div>
                      <p className="text-sm font-medium text-white mt-0.5">{opp.title}</p>
                      {opp.description && (
                        <p className="text-xs text-gray-400 mt-1 leading-relaxed">{opp.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-600">
                        <span className="capitalize">{opp.source.replace('_', ' ')}</span>
                        {opp.asset_class && <span className="capitalize">{opp.asset_class}</span>}
                        <span>{new Date(opp.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    {!opp.is_read && (
                      <button
                        onClick={() => markRead(opp.id)}
                        className="shrink-0 text-gray-600 hover:text-gray-400 transition-colors"
                        title="Mark as read"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
