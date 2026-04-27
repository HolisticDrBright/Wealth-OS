'use client'

import { useState, useTransition } from 'react'
import { syncKrakenBalances } from '@/lib/actions/crypto'
import type { CryptoPortfolioPosition, CryptoPrice } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Bitcoin, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react'
import { AssetStrategyPanel } from '@/components/trading/AssetStrategyPanel'

interface Props {
  initialPortfolio: CryptoPortfolioPosition[]
  initialPrices: CryptoPrice[]
}

export function CryptoClient({ initialPortfolio, initialPrices }: Props) {
  const [portfolio, setPortfolio] = useState(initialPortfolio)
  const [prices] = useState(initialPrices)
  const [syncing, startTransition] = useTransition()
  const [syncError, setSyncError] = useState<string | null>(null)

  const totalValue = portfolio.reduce((s, p) => s + p.balance_usd, 0)
  const totalPnl = portfolio.reduce((s, p) => s + p.unrealized_pnl_usd, 0)

  const priceMap = Object.fromEntries(prices.map(p => [p.symbol, p]))

  function handleSync() {
    setSyncError(null)
    startTransition(async () => {
      const result = await syncKrakenBalances()
      if (result.error) {
        setSyncError(result.error)
      }
      // Page would need a reload to reflect new data; in production use router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Crypto Portfolio</h1>
          <p className="text-sm text-gray-400 mt-1">Powered by Kraken</p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-300 hover:bg-white/10 transition-colors"
        >
          <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
          Sync Kraken
        </button>
      </div>

      {syncError && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {syncError}
        </div>
      )}

      {/* Portfolio summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Total Value</p>
          <p className="text-2xl font-bold text-white mt-1">${totalValue.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Unrealized P&amp;L</p>
          <p className={cn('text-2xl font-bold mt-1', totalPnl >= 0 ? 'text-green-400' : 'text-red-400')}>
            {totalPnl >= 0 ? '+' : ''}${totalPnl.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Positions</p>
          <p className="text-2xl font-bold text-white mt-1">{portfolio.length}</p>
        </div>
      </div>

      {/* Portfolio holdings */}
      {portfolio.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Holdings</h2>
          <div className="flex flex-col gap-2">
            {portfolio.map(pos => {
              const price = priceMap[pos.symbol]
              const pnlPct = pos.avg_cost_usd && pos.avg_cost_usd > 0
                ? ((pos.balance_usd / (pos.balance * pos.avg_cost_usd)) - 1) * 100
                : null
              return (
                <div key={pos.id} className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-500/20 shrink-0">
                    <Bitcoin className="h-5 w-5 text-orange-400" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-white">{pos.symbol}</p>
                      <p className="font-mono font-semibold text-white">${pos.balance_usd.toLocaleString()}</p>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-sm text-gray-400">{pos.balance.toFixed(6)} {pos.symbol}</p>
                      {pnlPct !== null && (
                        <span className={cn('text-xs font-medium flex items-center gap-1', pnlPct >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {pnlPct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Live prices */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Market Prices</h2>
        {prices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Bitcoin className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">No price data — prices sync every 5 minutes</p>
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase">Symbol</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Price</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">24h Change</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Volume 24h</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase">Bid / Ask</th>
                </tr>
              </thead>
              <tbody>
                {prices.map(p => (
                  <tr key={p.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-4 py-3 font-medium text-white">{p.symbol}</td>
                    <td className="px-4 py-3 text-right font-mono text-white">${p.price_usd.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      {p.change_pct_24h != null ? (
                        <span className={cn('font-medium', p.change_pct_24h >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {p.change_pct_24h >= 0 ? '+' : ''}{p.change_pct_24h.toFixed(2)}%
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 font-mono">
                      {p.volume_24h ? `$${(p.volume_24h / 1e6).toFixed(1)}M` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 font-mono text-xs">
                      {p.bid && p.ask ? `${p.bid.toLocaleString()} / ${p.ask.toLocaleString()}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Strategies */}
      <AssetStrategyPanel assetClasses={['crypto']} />
    </div>
  )
}
