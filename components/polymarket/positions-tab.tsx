'use client'

import { useState, useEffect, useTransition } from 'react'
import { TrendingUp, TrendingDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createMetaPolyWS, metaPolyWsUrl } from '@/lib/meta-poly/ws'
import { closePositionAction, recordPolyOutcomeAction } from '@/lib/actions/polymarket'
import { StrategyToggles } from './strategy-toggles'
import type { PortfolioPosition, PortfolioStats, SettingsResponse } from '@/lib/meta-poly/types'

interface Props {
  initialPositions: PortfolioPosition[]
  initialStats: PortfolioStats
  initialSettings: SettingsResponse | null
}

export function PositionsTab({ initialPositions, initialStats, initialSettings }: Props) {
  const [positions, setPositions] = useState(initialPositions)
  const [totalPnl, setTotalPnl] = useState(initialStats.unrealized_pnl)
  const [closing, startClose] = useTransition()
  const [closeErrors, setCloseErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    const ws = createMetaPolyWS(metaPolyWsUrl(), {
      position_closed: data => {
        setPositions(ps => ps.filter(p => p.market_id !== data.market_id))
        setTotalPnl(prev => prev + (data.pnl ?? 0))
        recordPolyOutcomeAction(data).catch(() => undefined)
      },
      position_settled: data => {
        setPositions(ps => ps.filter(p => p.market_id !== data.market_id))
        setTotalPnl(prev => prev + (data.pnl ?? 0))
        recordPolyOutcomeAction(data).catch(() => undefined)
      },
    })
    return () => ws.close()
  }, [])

  function handleClose(marketId: string) {
    setCloseErrors(e => ({ ...e, [marketId]: '' }))
    startClose(async () => {
      const result = await closePositionAction(marketId)
      if (result.error) {
        setCloseErrors(e => ({ ...e, [marketId]: result.error! }))
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Open positions" value={String(positions.length)} />
        <StatTile
          label="Unrealized P&L"
          value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`}
          valueClass={totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}
        />
        <StatTile
          label="Balance"
          value={`$${initialStats.balance.toFixed(2)}`}
        />
      </div>

      {/* Positions list */}
      {positions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-16 text-center">
          <p className="text-sm font-medium text-white">No open positions</p>
          <p className="text-xs text-gray-500">
            Positions appear here when the scheduler opens trades.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {positions.map(pos => (
            <PositionCard
              key={pos.id}
              position={pos}
              onClose={() => handleClose(pos.market_id)}
              closing={closing}
              error={closeErrors[pos.market_id]}
            />
          ))}
        </div>
      )}

      {/* Strategy toggles */}
      <StrategyToggles initialSettings={initialSettings} />
    </div>
  )
}

function PositionCard({
  position: p,
  onClose,
  closing,
  error,
}: {
  position: PortfolioPosition
  onClose: () => void
  closing: boolean
  error?: string
}) {
  const pnlPositive = p.pnl >= 0
  const isBull = p.side === 'YES'

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-medium text-white">{p.question}</p>
        <button
          onClick={onClose}
          disabled={closing}
          className="shrink-0 rounded-lg border border-white/10 p-1.5 text-gray-500 hover:border-red-500/30 hover:text-red-400 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          title="Close position"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Side + strategy badges */}
      <div className="flex flex-wrap gap-2">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-bold',
            isBull ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
          )}
        >
          {p.side}
        </span>
        <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-400">
          {p.strategy.replace('_', ' ')}
        </span>
        {p.source === 'clob_api' && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
            CLOB
          </span>
        )}
      </div>

      {/* Price row */}
      <div className="flex gap-4 text-xs text-gray-400">
        <span>
          Entry{' '}
          <span className="font-mono text-white">{(p.entry_price * 100).toFixed(1)}¢</span>
        </span>
        <span>
          Now{' '}
          <span className="font-mono text-white">{(p.current_price * 100).toFixed(1)}¢</span>
        </span>
        <span>
          Size{' '}
          <span className="font-mono text-white">${p.size_usdc.toFixed(0)}</span>
        </span>
      </div>

      {/* P&L */}
      <div className="flex items-center gap-2">
        {pnlPositive ? (
          <TrendingUp className="h-4 w-4 text-green-400" />
        ) : (
          <TrendingDown className="h-4 w-4 text-red-400" />
        )}
        <span className={cn('text-sm font-semibold', pnlPositive ? 'text-green-400' : 'text-red-400')}>
          {pnlPositive ? '+' : ''}${p.pnl.toFixed(2)}
        </span>
        <span className={cn('text-xs', pnlPositive ? 'text-green-400/70' : 'text-red-400/70')}>
          ({pnlPositive ? '+' : ''}{(p.pnl_pct * 100).toFixed(1)}%)
        </span>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

function StatTile({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={cn('mt-0.5 text-lg font-bold text-white', valueClass)}>{value}</p>
    </div>
  )
}
