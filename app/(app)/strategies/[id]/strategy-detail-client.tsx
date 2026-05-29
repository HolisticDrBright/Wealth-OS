'use client'

import type { Strategy, StrategyPosition } from '@/lib/types'
import type { StrategyMetrics } from '@/lib/actions/strategies'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import {
  ArrowLeft, TrendingUp, TrendingDown, BarChart2,
  CheckCircle, Clock,
} from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid,
} from 'recharts'

interface Props {
  strategy: Strategy
  positions: StrategyPosition[]
  metrics: StrategyMetrics
}

export function StrategyDetailClient({ strategy, positions, metrics }: Props) {
  // Build cumulative P&L series from closed positions
  const closedSorted = [...positions]
    .filter(p => p.status === 'closed' && p.closed_at)
    .sort((a, b) => new Date(a.closed_at!).getTime() - new Date(b.closed_at!).getTime())

  // Cumulative P&L from raw running total (rounded only for display, matching prior behavior).
  const pnlSeries = closedSorted.reduce<{ acc: { date: string; pnl: number }[]; running: number }>(
    (state, p) => {
      const running = state.running + p.pnl_usd
      state.acc.push({
        date: new Date(p.closed_at!).toLocaleDateString(),
        pnl: Math.round(running * 100) / 100,
      })
      return { acc: state.acc, running }
    },
    { acc: [], running: 0 }
  ).acc

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Back */}
      <Link href="/strategies" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors w-fit">
        <ArrowLeft className="h-4 w-4" />
        All Strategies
      </Link>

      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold text-white">{strategy.name}</h1>
          <span className={cn(
            'text-xs px-2 py-0.5 rounded-full font-medium',
            strategy.is_active ? 'bg-green-400/10 text-green-400' : 'bg-gray-400/10 text-gray-400'
          )}>
            {strategy.is_active ? 'Active' : 'Inactive'}
          </span>
          {strategy.type && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-400/10 text-indigo-400 capitalize">
              {strategy.type.replace('_', ' ')}
            </span>
          )}
        </div>
        {strategy.description && (
          <p className="text-sm text-gray-400">{strategy.description}</p>
        )}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-5 gap-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Total P&L</p>
          <p className={cn('text-2xl font-bold mt-1', metrics.total_pnl >= 0 ? 'text-green-400' : 'text-red-400')}>
            {metrics.total_pnl >= 0 ? '+' : ''}${metrics.total_pnl.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Win Rate</p>
          <p className="text-2xl font-bold text-white mt-1">{metrics.win_rate.toFixed(1)}%</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Avg P&L / Trade</p>
          <p className={cn('text-2xl font-bold mt-1', metrics.avg_pnl_per_trade >= 0 ? 'text-green-400' : 'text-red-400')}>
            ${metrics.avg_pnl_per_trade.toFixed(0)}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Open</p>
          <p className="text-2xl font-bold text-indigo-400 mt-1">{metrics.open_positions}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Closed</p>
          <p className="text-2xl font-bold text-white mt-1">{metrics.closed_positions}</p>
        </div>
      </div>

      {/* P&L chart */}
      {pnlSeries.length > 1 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <p className="text-sm font-semibold text-gray-300 mb-4">Cumulative P&L</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={pnlSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip
                contentStyle={{ background: '#0a0b0f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                labelStyle={{ color: '#9ca3af' }}
                formatter={(v) => [`$${Number(v).toLocaleString()}`, 'Cumulative P&L']}
              />
              <Line type="monotone" dataKey="pnl" stroke="#6366f1" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Positions table */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Positions</h2>
        {positions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <BarChart2 className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">No positions yet</p>
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Symbol</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Action</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Entry</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Exit</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">P&L</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Opened</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(pos => (
                  <tr key={pos.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3 font-medium text-white">{pos.symbol}</td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'flex items-center gap-1 text-xs font-medium w-fit',
                        pos.action === 'buy' ? 'text-green-400' : 'text-red-400'
                      )}>
                        {pos.action === 'buy' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {pos.action.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-300">
                      {pos.entry_price ? `$${pos.entry_price.toLocaleString()}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-300">
                      {pos.exit_price ? `$${pos.exit_price.toLocaleString()}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">
                      <span className={pos.pnl_usd >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {pos.pnl_usd >= 0 ? '+' : ''}${pos.pnl_usd.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'inline-flex items-center gap-1 text-xs',
                        pos.status === 'open' ? 'text-indigo-400' : 'text-gray-400'
                      )}>
                        {pos.status === 'open' ? <Clock className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
                        {pos.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(pos.opened_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
