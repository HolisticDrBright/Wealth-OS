'use client'

import { useState, useTransition } from 'react'
import { syncOandaPositions } from '@/lib/actions/forex'
import type { ForexRate, ForexPosition } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Globe, RefreshCw } from 'lucide-react'
import { AssetStrategyPanel } from '@/components/trading/AssetStrategyPanel'
import type { ProfileKey } from '@/lib/strategies/strategy-registry'

interface Props {
  initialRates: ForexRate[]
  initialPositions: ForexPosition[]
  userProfileKey?: ProfileKey
}

export function ForexClient({ initialRates, initialPositions, userProfileKey }: Props) {
  const [rates] = useState(initialRates)
  const [positions] = useState(initialPositions)
  const [syncing, startTransition] = useTransition()
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  function handleSync() {
    setSyncMsg(null)
    startTransition(async () => {
      const result = await syncOandaPositions()
      if (result.error) {
        setSyncMsg(`Error: ${result.error}`)
      } else {
        setSyncMsg(`Synced ${result.synced} positions`)
      }
    })
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Forex</h1>
          <p className="text-sm text-gray-400 mt-1">Live rates & OANDA positions</p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors"
        >
          <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
          Sync OANDA
        </button>
      </div>

      {syncMsg && (
        <div className={cn(
          'rounded-lg border px-4 py-3 text-sm',
          syncMsg.startsWith('Error') ? 'border-red-500/20 bg-red-500/10 text-red-400' : 'border-green-500/20 bg-green-500/10 text-green-400'
        )}>
          {syncMsg}
        </div>
      )}

      {/* Live rates table */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Major Pairs</h2>
        {rates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Globe className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">No rate data — rates sync every minute</p>
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Pair</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Bid</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Ask</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Spread (pips)</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rates.map(rate => (
                  <tr key={rate.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3 font-medium text-white">{rate.instrument.replace('_', '/')}</td>
                    <td className="px-4 py-3 text-right font-mono text-green-400">{rate.bid.toFixed(5)}</td>
                    <td className="px-4 py-3 text-right font-mono text-red-400">{rate.ask.toFixed(5)}</td>
                    <td className="px-4 py-3 text-right text-gray-400">
                      {rate.spread_pips != null ? rate.spread_pips.toFixed(1) : ((rate.ask - rate.bid) * 10000).toFixed(1)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 text-xs">
                      {new Date(rate.fetched_at).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Strategies */}
      <AssetStrategyPanel assetClasses={['forex', 'multi-asset']} userProfileKey={userProfileKey} />
    </div>
  )
}
