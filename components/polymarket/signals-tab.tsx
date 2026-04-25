'use client'

import { useState, useEffect } from 'react'
import { SignalCard } from './signal-card'
import { createMetaPolyWS, metaPolyWsUrl } from '@/lib/meta-poly/ws'
import type { Signal, SignalStrategy } from '@/lib/meta-poly/types'
import { cn } from '@/lib/utils'

const FILTER_OPTIONS: Array<{ id: SignalStrategy | 'all'; label: string }> = [
  { id: 'all',          label: 'All' },
  { id: 'entropy',      label: 'Entropy' },
  { id: 'ensemble_ai',  label: 'Ensemble' },
  { id: 'avellaneda',   label: 'Avellaneda' },
  { id: 'binance_arb',  label: 'Binance Arb' },
  { id: 'theta',        label: 'Theta' },
  { id: 'jet',          label: 'Jet' },
  { id: 'copy',         label: 'Copy' },
]

interface Props {
  initialSignals: Signal[]
}

export function SignalsTab({ initialSignals }: Props) {
  const [signals, setSignals] = useState<Signal[]>(initialSignals)
  const [liveIds, setLiveIds] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<SignalStrategy | 'all'>('all')

  useEffect(() => {
    const ws = createMetaPolyWS(metaPolyWsUrl(), {
      signal: data => {
        const id = `ws-${data.strategy}-${data.market_id}-${Date.now()}`
        const incoming: Signal = {
          id,
          strategy: data.strategy as SignalStrategy,
          market_id: data.market_id,
          question: data.market_id,
          side: data.side,
          price: data.price ?? 0,
          size_usdc: data.size_usdc ?? 0,
          confidence: data.confidence,
          reason: 'Live signal',
          kl_divergence: 0,
          kelly_fraction: 0,
          confluence_count: 0,
          timestamp: new Date().toISOString(),
        }
        setSignals(s => [incoming, ...s].slice(0, 200))
        setLiveIds(ids => {
          const next = new Set(ids)
          next.add(id)
          // Remove "live" marker after 30s
          setTimeout(() => setLiveIds(i => { const n = new Set(i); n.delete(id); return n }), 30_000)
          return next
        })
      },
    })
    return () => ws.close()
  }, [])

  const visible =
    filter === 'all' ? signals : signals.filter(s => s.strategy === filter)

  return (
    <div className="flex flex-col gap-4">
      {/* Strategy filter pills */}
      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.id}
            onClick={() => setFilter(opt.id)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-all',
              filter === opt.id
                ? 'bg-white/15 text-white'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
            )}
          >
            {opt.label}
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-gray-500">
          {visible.length} signals
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-20 text-center">
          <p className="text-sm font-medium text-white">No signals yet</p>
          <p className="text-xs text-gray-500">
            Signals appear here as the scheduler generates them, or when new ones
            arrive via the live WebSocket feed.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map(signal => (
            <SignalCard
              key={signal.id}
              signal={signal}
              isLive={liveIds.has(signal.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
