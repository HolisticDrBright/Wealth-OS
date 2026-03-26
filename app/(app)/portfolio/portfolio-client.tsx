'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AssetForm } from '@/components/forms/asset-form'
import { formatCurrency, formatPercentage } from '@/lib/utils'
import { deleteAsset } from '@/lib/actions/assets'
import type { Asset } from '@/lib/types'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'
import { TrendingUp, TrendingDown, Plus, Pencil, Trash2, Info, RefreshCw } from 'lucide-react'
import { refreshAssetPrices } from '@/lib/actions/prices'
import type { PriceResult } from '@/lib/prices'

const categoryColors: Record<string, string> = {
  stock: '#6366f1',
  crypto: '#f59e0b',
  real_estate: '#10b981',
  cash: '#3b82f6',
  bond: '#ec4899',
  other: '#8b5cf6',
}

const categoryLabels: Record<string, string> = {
  stock: 'Stocks',
  crypto: 'Crypto',
  real_estate: 'Real Estate',
  cash: 'Cash',
  bond: 'Bonds',
  other: 'Other',
}

interface Props {
  assets: Asset[]
  isDemo: boolean
}

export function PortfolioClient({ assets: initialAssets, isDemo }: Props) {
  const [assets, setAssets] = useState<Asset[]>(initialAssets)
  const [showForm, setShowForm] = useState(false)
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [priceData, setPriceData] = useState<PriceResult[]>([])
  const [refreshMsg, setRefreshMsg] = useState('')
  const router = useRouter()

  function handleRefreshPrices() {
    setIsRefreshing(true)
    setRefreshMsg('')
    startTransition(async () => {
      const result = await refreshAssetPrices()
      setIsRefreshing(false)
      if (result.error) {
        setRefreshMsg(`⚠ ${result.error}`)
      } else {
        setLastUpdated(new Date().toLocaleTimeString())
        setPriceData(result.prices ?? [])
        setRefreshMsg(`✓ Updated ${result.updated} position${result.updated !== 1 ? 's' : ''}`)
        router.refresh() // re-fetches server data without wiping client state
      }
    })
  }

  const totalValue = assets.reduce((s, a) => s + a.current_value, 0)

  // Group by category for allocation chart
  const allocationMap = assets.reduce<Record<string, number>>((acc, a) => {
    acc[a.category] = (acc[a.category] ?? 0) + a.current_value
    return acc
  }, {})
  const allocationData = Object.entries(allocationMap).map(([cat, value]) => ({
    name: categoryLabels[cat] ?? cat,
    value,
    percentage: totalValue > 0 ? ((value / totalValue) * 100).toFixed(1) : '0',
    fill: categoryColors[cat] ?? '#8b5cf6',
  }))

  const performanceData = assets
    .filter(a => a.purchase_price && a.symbol)
    .map(a => {
      const cost = a.purchase_price! * (a.quantity ?? 1)
      const gain = ((a.current_value - cost) / cost) * 100
      return { name: a.symbol!, gain }
    })
    .sort((a, b) => b.gain - a.gain)

  const totalUnrealizedGain = assets.reduce((s, a) => {
    if (!a.purchase_price) return s
    const cost = a.purchase_price * (a.quantity ?? 1)
    return s + (a.current_value - cost)
  }, 0)

  function handleDelete(id: string) {
    if (!confirm('Delete this asset?')) return
    startTransition(async () => {
      const result = await deleteAsset(id)
      if (!result.error) {
        setAssets(prev => prev.filter(a => a.id !== id))
      }
    })
  }

  function handleEditClose() {
    setEditingAsset(null)
    setShowForm(false)
    // Reload is triggered by revalidatePath in the server action
  }

  return (
    <div className="p-6 space-y-6">
      {isDemo && (
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-400">
            Showing <strong className="text-indigo-400">demo data</strong>. Click <strong className="text-white">Add Asset</strong> to start tracking your real investments.
          </p>
        </div>
      )}

      {/* Refresh bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={handleRefreshPrices} disabled={isRefreshing}>
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh Prices'}
          </Button>
          {lastUpdated && <span className="text-xs text-gray-500">Updated {lastUpdated}</span>}
        </div>
        {refreshMsg && (
          <span className={`text-xs font-medium ${refreshMsg.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
            {refreshMsg}
          </span>
        )}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Portfolio Value</p>
          <p className="mt-2 text-2xl font-bold text-white">{formatCurrency(totalValue)}</p>
          <p className="mt-1 text-xs text-gray-500">Across {assets.length} positions</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Unrealized Gains</p>
          <p className={`mt-2 text-2xl font-bold ${totalUnrealizedGain >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalUnrealizedGain >= 0 ? '+' : ''}{formatCurrency(totalUnrealizedGain)}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {totalValue > 0 && totalUnrealizedGain !== 0
              ? `${((totalUnrealizedGain / (totalValue - totalUnrealizedGain)) * 100).toFixed(1)}% overall return`
              : 'No purchase data'}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Best Performer</p>
          {performanceData.length > 0 ? (
            <>
              <p className="mt-2 text-2xl font-bold text-white">{performanceData[0].name}</p>
              <p className="mt-1 text-xs text-emerald-400">{formatPercentage(performanceData[0].gain)} since purchase</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-gray-500">—</p>
          )}
        </Card>
      </div>

      {/* Charts */}
      {assets.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Asset Allocation</CardTitle>
              <CardDescription>Portfolio diversification by category</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6">
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie
                      data={allocationData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {allocationData.map((entry, index) => (
                        <Cell key={index} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                      formatter={(value) => [formatCurrency(Number(value)), '']}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {allocationData.map((item) => (
                    <div key={item.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.fill }} />
                        <span className="text-sm text-gray-300">{item.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-medium text-white">{item.percentage}%</span>
                        <p className="text-xs text-gray-500">{formatCurrency(item.value)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {performanceData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Position Returns</CardTitle>
                <CardDescription>% gain/loss per symbol</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={performanceData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fill: '#6b7280', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `${v.toFixed(0)}%`}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fill: '#9ca3af', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={40}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                      formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Return']}
                    />
                    <Bar dataKey="gain" radius={[0, 4, 4, 0]}>
                      {performanceData.map((entry, index) => (
                        <Cell key={index} fill={entry.gain >= 0 ? '#6366f1' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Asset Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>All Positions</CardTitle>
              <CardDescription>Your complete investment portfolio</CardDescription>
            </div>
            <Button size="sm" onClick={() => { setEditingAsset(null); setShowForm(true) }}>
              <Plus className="h-4 w-4" /> Add Asset
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/10">
                <TrendingUp className="h-6 w-6 text-indigo-400" />
              </div>
              <p className="text-sm font-medium text-white">No assets yet</p>
              <p className="mt-1 text-xs text-gray-500">Add your first investment to start tracking your portfolio</p>
              <Button size="sm" className="mt-4" onClick={() => setShowForm(true)}>
                <Plus className="h-4 w-4" /> Add Your First Asset
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="pb-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Asset</th>
                    <th className="pb-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                    <th className="pb-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                    <th className="pb-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">24h</th>
                    <th className="pb-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Allocation</th>
                    <th className="pb-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Return</th>
                    <th className="pb-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {assets.map((asset) => {
                    const cost = asset.purchase_price ? asset.purchase_price * (asset.quantity ?? 1) : null
                    const gainLossPct = cost ? ((asset.current_value - cost) / cost) * 100 : null
                    return (
                      <tr key={asset.id} className="hover:bg-white/5 transition-colors">
                        <td className="py-3">
                          <div>
                            <p className="font-medium text-white">{asset.name}</p>
                            {asset.symbol && <p className="text-xs text-gray-500">{asset.symbol}{asset.quantity ? ` · ${asset.quantity} units` : ''}</p>}
                          </div>
                        </td>
                        <td className="py-3">
                          <Badge>
                            <span className="h-1.5 w-1.5 rounded-full mr-1.5 inline-block" style={{ backgroundColor: categoryColors[asset.category] }} />
                            {categoryLabels[asset.category]}
                          </Badge>
                        </td>
                        <td className="py-3 text-right font-medium text-white">
                          {formatCurrency(asset.current_value)}
                          {asset.symbol && priceData.find(p => p.symbol.toUpperCase() === asset.symbol?.toUpperCase())?.price ? (
                            <p className="text-xs text-gray-500">
                              @ {formatCurrency(priceData.find(p => p.symbol.toUpperCase() === asset.symbol?.toUpperCase())!.price)}
                            </p>
                          ) : null}
                        </td>
                        <td className="py-3 text-right">
                          {(() => {
                            const p = asset.symbol ? priceData.find(pd => pd.symbol.toUpperCase() === asset.symbol?.toUpperCase()) : null
                            if (!p || p.source === 'error') return <span className="text-gray-600 text-xs">—</span>
                            return (
                              <span className={`text-xs font-medium ${p.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {p.changePercent >= 0 ? '+' : ''}{p.changePercent.toFixed(2)}%
                              </span>
                            )
                          })()}
                        </td>
                        <td className="py-3 text-right text-gray-400">
                          {totalValue > 0 ? ((asset.current_value / totalValue) * 100).toFixed(1) : 0}%
                        </td>
                        <td className="py-3 text-right">
                          {gainLossPct !== null ? (
                            <div className="flex items-center justify-end gap-1">
                              {gainLossPct >= 0 ? (
                                <TrendingUp className="h-3 w-3 text-emerald-400" />
                              ) : (
                                <TrendingDown className="h-3 w-3 text-red-400" />
                              )}
                              <span className={gainLossPct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                {formatPercentage(gainLossPct)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => { setEditingAsset(asset); setShowForm(true) }}
                              className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(asset.id)}
                              disabled={isPending}
                              className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AssetForm
        open={showForm}
        onClose={handleEditClose}
        asset={editingAsset}
      />
    </div>
  )
}
