'use client'

import { useState, useTransition } from 'react'
import { createStrategy, updateStrategy } from '@/lib/actions/strategies'
import type { Strategy } from '@/lib/types'
import { cn } from '@/lib/utils'
import { BarChart2, Plus, ToggleLeft, ToggleRight, ChevronRight } from 'lucide-react'
import Link from 'next/link'

interface Props {
  initialStrategies: Strategy[]
}

const TYPE_COLORS: Record<string, string> = {
  momentum:   'text-orange-400 bg-orange-400/10',
  value:      'text-blue-400 bg-blue-400/10',
  copy_trade: 'text-indigo-400 bg-indigo-400/10',
  manual:     'text-gray-400 bg-gray-400/10',
  rebalance:  'text-green-400 bg-green-400/10',
  harvest:    'text-yellow-400 bg-yellow-400/10',
}

export function StrategiesClient({ initialStrategies }: Props) {
  const [strategies, setStrategies] = useState(initialStrategies)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<Strategy['type']>('manual')
  const [assetClass, setAssetClass] = useState('')
  const [pending, startTransition] = useTransition()

  function handleCreate() {
    if (!name.trim()) return
    startTransition(async () => {
      const created = await createStrategy({
        name: name.trim(),
        description: description.trim() || undefined,
        type,
        asset_class: assetClass || undefined,
      })
      if (created) {
        setStrategies(prev => [created, ...prev])
        setName('')
        setDescription('')
        setType('manual')
        setAssetClass('')
        setShowForm(false)
      }
    })
  }

  function handleToggle(id: string, isActive: boolean) {
    startTransition(async () => {
      await updateStrategy(id, { is_active: !isActive })
      setStrategies(prev => prev.map(s => s.id === id ? { ...s, is_active: !isActive } : s))
    })
  }

  const activeCount = strategies.filter(s => s.is_active).length

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Strategies</h1>
          <p className="text-sm text-gray-400 mt-1">
            {activeCount} active · {strategies.length} total
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Strategy
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-5 flex flex-col gap-4">
          <p className="font-semibold text-white">New Strategy</p>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Strategy name"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
          <div className="grid grid-cols-2 gap-3">
            <select
              value={type ?? 'manual'}
              onChange={e => setType(e.target.value as Strategy['type'])}
              className="rounded-lg border border-white/10 bg-[#0a0b0f] px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="manual">Manual</option>
              <option value="copy_trade">Copy Trade</option>
              <option value="momentum">Momentum</option>
              <option value="value">Value</option>
              <option value="rebalance">Rebalance</option>
              <option value="harvest">Tax Harvest</option>
            </select>
            <select
              value={assetClass}
              onChange={e => setAssetClass(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#0a0b0f] px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="">All Asset Classes</option>
              <option value="stock">Stocks</option>
              <option value="crypto">Crypto</option>
              <option value="forex">Forex</option>
              <option value="polymarket">Polymarket</option>
            </select>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={pending || !name.trim()}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              Create
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-lg bg-white/5 text-sm font-medium text-gray-300 hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Strategy list */}
      {strategies.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <BarChart2 className="h-10 w-10 mb-3 opacity-30" />
          <p>No strategies yet</p>
          <p className="text-sm mt-1">Create a strategy to track your trading approaches</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {strategies.map(strategy => (
            <div
              key={strategy.id}
              className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-center gap-4 hover:bg-white/8 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-medium text-white truncate">{strategy.name}</p>
                  {strategy.type && (
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', TYPE_COLORS[strategy.type] ?? TYPE_COLORS.manual)}>
                      {strategy.type.replace('_', ' ')}
                    </span>
                  )}
                  {strategy.asset_class && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-gray-400 capitalize">
                      {strategy.asset_class}
                    </span>
                  )}
                </div>
                {strategy.description && (
                  <p className="text-sm text-gray-400 truncate">{strategy.description}</p>
                )}
                <p className="text-xs text-gray-600 mt-1">
                  Created {new Date(strategy.created_at).toLocaleDateString()}
                </p>
              </div>

              <button
                onClick={() => handleToggle(strategy.id, strategy.is_active)}
                disabled={pending}
                className={cn('shrink-0 transition-colors', strategy.is_active ? 'text-indigo-400' : 'text-gray-600 hover:text-gray-400')}
              >
                {strategy.is_active
                  ? <ToggleRight className="h-6 w-6" />
                  : <ToggleLeft className="h-6 w-6" />}
              </button>

              <Link
                href={`/strategies/${strategy.id}`}
                className="shrink-0 text-gray-500 hover:text-white transition-colors"
              >
                <ChevronRight className="h-5 w-5" />
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
