'use client'

import { useState, useTransition } from 'react'
import { cancelOrder } from '@/lib/actions/orders'
import type { Order } from '@/lib/types'
import { cn } from '@/lib/utils'
import {
  ShoppingCart, Clock, CheckCircle, XCircle, AlertCircle,
  TrendingUp, TrendingDown, RefreshCw,
} from 'lucide-react'

interface Props {
  initialOrders: Order[]
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending:          { label: 'Pending',          color: 'text-yellow-400 bg-yellow-400/10',  icon: Clock },
  submitted:        { label: 'Submitted',         color: 'text-blue-400 bg-blue-400/10',      icon: Clock },
  open:             { label: 'Open',              color: 'text-indigo-400 bg-indigo-400/10',  icon: RefreshCw },
  partially_filled: { label: 'Partial',           color: 'text-orange-400 bg-orange-400/10', icon: RefreshCw },
  filled:           { label: 'Filled',            color: 'text-green-400 bg-green-400/10',   icon: CheckCircle },
  cancelled:        { label: 'Cancelled',         color: 'text-gray-400 bg-gray-400/10',     icon: XCircle },
  rejected:         { label: 'Rejected',          color: 'text-red-400 bg-red-400/10',       icon: XCircle },
  expired:          { label: 'Expired',           color: 'text-gray-500 bg-gray-500/10',     icon: AlertCircle },
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  copy_trade: 'Copy Trade',
  rebalance: 'Rebalance',
  harvest: 'Tax Harvest',
  rule: 'Autopilot Rule',
}

const CANCELLABLE = new Set(['pending', 'submitted', 'open'])

export function OrdersClient({ initialOrders }: Props) {
  const [orders, setOrders] = useState(initialOrders)
  const [filter, setFilter] = useState<Order['status'] | 'all'>('all')
  const [pending, startTransition] = useTransition()

  const filtered = filter === 'all' ? orders : orders.filter(o => o.status === filter)

  const totalOpenNotional = orders
    .filter(o => o.status === 'open' || o.status === 'partially_filled')
    .reduce((s, o) => s + (o.notional_usd ?? 0), 0)

  const filledToday = orders.filter(o => {
    if (o.status !== 'filled') return false
    const d = o.filled_at ? new Date(o.filled_at) : null
    if (!d) return false
    const today = new Date()
    return d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
  })

  function handleCancel(id: string) {
    startTransition(async () => {
      await cancelOrder(id)
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status: 'cancelled' as Order['status'] } : o))
    })
  }

  const statuses = ['all', 'pending', 'submitted', 'open', 'filled', 'cancelled'] as const

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Order Blotter</h1>
        <p className="text-sm text-gray-400 mt-1">Track and manage all your orders across brokers</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Total Orders</p>
          <p className="text-2xl font-bold text-white mt-1">{orders.length}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Open Notional</p>
          <p className="text-2xl font-bold text-indigo-400 mt-1">${totalOpenNotional.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Filled Today</p>
          <p className="text-2xl font-bold text-green-400 mt-1">{filledToday.length}</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {statuses.map(s => (
          <button
            key={s}
            onClick={() => setFilter(s as typeof filter)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all',
              filter === s
                ? 'bg-indigo-600 text-white'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
            )}
          >
            {s === 'all' ? 'All' : STATUS_CONFIG[s]?.label ?? s}
            {s !== 'all' && (
              <span className="ml-1.5 text-gray-500">
                {orders.filter(o => o.status === s).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <ShoppingCart className="h-10 w-10 mb-3 opacity-30" />
          <p>No orders found</p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Symbol</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Side</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Type</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Notional</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Source</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Broker</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Time</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(order => {
                const statusCfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.pending
                const StatusIcon = statusCfg.icon
                return (
                  <tr key={order.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">{order.symbol}</span>
                        <span className="text-xs text-gray-500">{order.asset_class}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'flex items-center gap-1 text-xs font-medium w-fit',
                        order.side === 'buy' ? 'text-green-400' : 'text-red-400'
                      )}>
                        {order.side === 'buy'
                          ? <TrendingUp className="h-3 w-3" />
                          : <TrendingDown className="h-3 w-3" />}
                        {order.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-300 capitalize">{order.order_type.replace('_', ' ')}</td>
                    <td className="px-4 py-3 text-right font-mono text-white">
                      ${(order.notional_usd ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium', statusCfg.color)}>
                        <StatusIcon className="h-3 w-3" />
                        {statusCfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {SOURCE_LABELS[order.source ?? ''] ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 capitalize text-xs">{order.broker ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(order.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      {CANCELLABLE.has(order.status) && (
                        <button
                          onClick={() => handleCancel(order.id)}
                          disabled={pending}
                          className="text-xs text-red-400 hover:text-red-300 transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
