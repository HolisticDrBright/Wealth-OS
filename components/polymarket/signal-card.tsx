'use client'

import { cn } from '@/lib/utils'
import type { Signal, SignalStrategy } from '@/lib/meta-poly/types'

interface Props {
  signal: Signal
  isLive?: boolean
}

const STRATEGY_COLORS: Record<SignalStrategy | string, string> = {
  entropy:         'bg-cyan-500/15 text-cyan-300',
  ensemble_ai:     'bg-violet-500/15 text-violet-300',
  avellaneda:      'bg-emerald-500/15 text-emerald-300',
  arb:             'bg-amber-500/15 text-amber-300',
  binance_arb:     'bg-amber-500/15 text-amber-300',
  theta:           'bg-blue-500/15 text-blue-300',
  jet:             'bg-orange-500/15 text-orange-300',
  copy:            'bg-pink-500/15 text-pink-300',
  correlation_arb: 'bg-amber-500/15 text-amber-300',
  manual:          'bg-gray-500/15 text-gray-300',
}

function strategyColor(s: string) {
  return STRATEGY_COLORS[s] ?? 'bg-gray-500/15 text-gray-300'
}

export function SignalCard({ signal, isLive = false }: Props) {
  const isBull = signal.side === 'YES'
  const confPct = Math.round(signal.confidence * 100)

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', strategyColor(signal.strategy))}>
            {signal.strategy.replace('_', ' ')}
          </span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-bold',
              isBull ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
            )}
          >
            {signal.side}
          </span>
          {isLive && (
            <span className="flex items-center gap-1 rounded-full bg-indigo-500/15 px-2 py-0.5 text-xs text-indigo-400">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-indigo-500" />
              </span>
              live
            </span>
          )}
        </div>
        <span className="shrink-0 text-xs text-gray-500">
          {new Date(signal.timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>

      {/* Question */}
      <p className="line-clamp-2 text-sm font-medium text-white">{signal.question}</p>

      {/* Confidence bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-gray-400">
          <span>Confidence</span>
          <span className="font-mono text-white">{confPct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              confPct >= 70 ? 'bg-green-500' : confPct >= 40 ? 'bg-amber-500' : 'bg-red-500'
            )}
            style={{ width: `${confPct}%` }}
          />
        </div>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
        {signal.price > 0 && (
          <span>
            Price <span className="font-mono text-white">{(signal.price * 100).toFixed(1)}¢</span>
          </span>
        )}
        {signal.size_usdc > 0 && (
          <span>
            Size <span className="font-mono text-white">${signal.size_usdc.toFixed(0)}</span>
          </span>
        )}
        {signal.kelly_fraction > 0 && (
          <span>
            Kelly <span className="font-mono text-white">{(signal.kelly_fraction * 100).toFixed(1)}%</span>
          </span>
        )}
        {signal.kl_divergence > 0 && (
          <span>
            KL <span className="font-mono text-white">{signal.kl_divergence.toFixed(4)}</span>
          </span>
        )}
        {signal.confluence_count > 0 && (
          <span>
            Confluence <span className="font-mono text-white">{signal.confluence_count}</span>
          </span>
        )}
      </div>

      {/* Reason */}
      {signal.reason && signal.reason !== 'Live signal' && (
        <p className="text-xs text-gray-500 line-clamp-2">{signal.reason}</p>
      )}
    </div>
  )
}
