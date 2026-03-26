'use client'

import { Topbar } from '@/components/layout/topbar'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatPercentage } from '@/lib/utils'
import { mockAssets, portfolioAllocation } from '@/lib/mock-data'
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
import { TrendingUp, TrendingDown } from 'lucide-react'

const totalValue = mockAssets.reduce((s, a) => s + a.current_value, 0)

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

export default function PortfolioPage() {
  const assetsWithGainLoss = mockAssets.map(asset => {
    const gainLoss = asset.purchase_price
      ? ((asset.current_value - (asset.purchase_price * (asset.quantity ?? 1))) / (asset.purchase_price * (asset.quantity ?? 1))) * 100
      : null
    return { ...asset, gainLossPct: gainLoss }
  })

  const performanceData = mockAssets
    .filter(a => a.purchase_price && a.symbol)
    .map(a => ({
      name: a.symbol!,
      gain: a.purchase_price
        ? ((a.current_value - a.purchase_price * (a.quantity ?? 1)) / (a.purchase_price * (a.quantity ?? 1))) * 100
        : 0,
    }))
    .sort((a, b) => b.gain - a.gain)

  return (
    <div>
      <Topbar title="Portfolio" subtitle="Investment positions and performance" />

      <div className="p-6 space-y-6">
        {/* Summary Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Portfolio Value</p>
            <p className="mt-2 text-2xl font-bold text-white">{formatCurrency(totalValue)}</p>
            <p className="mt-1 text-xs text-gray-500">Across {mockAssets.length} positions</p>
          </Card>
          <Card>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Unrealized Gains</p>
            <p className="mt-2 text-2xl font-bold text-emerald-400">+{formatCurrency(52550)}</p>
            <p className="mt-1 text-xs text-emerald-400/70">+36.2% overall return</p>
          </Card>
          <Card>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Best Performer</p>
            <p className="mt-2 text-2xl font-bold text-white">BTC</p>
            <p className="mt-1 text-xs text-emerald-400">+125% since purchase</p>
          </Card>
        </div>

        {/* Allocation + Performance */}
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
                      data={portfolioAllocation}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {portfolioAllocation.map((entry, index) => (
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
                  {portfolioAllocation.map((item) => (
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
        </div>

        {/* Asset Table */}
        <Card>
          <CardHeader>
            <CardTitle>All Positions</CardTitle>
            <CardDescription>Your complete investment portfolio</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="pb-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Asset</th>
                    <th className="pb-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                    <th className="pb-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                    <th className="pb-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Allocation</th>
                    <th className="pb-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Gain/Loss</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {assetsWithGainLoss.map((asset) => (
                    <tr key={asset.id} className="hover:bg-white/5 transition-colors">
                      <td className="py-3">
                        <div>
                          <p className="font-medium text-white">{asset.name}</p>
                          {asset.symbol && <p className="text-xs text-gray-500">{asset.symbol}{asset.quantity ? ` · ${asset.quantity} units` : ''}</p>}
                        </div>
                      </td>
                      <td className="py-3">
                        <Badge>
                          <span className="h-1.5 w-1.5 rounded-full mr-1.5" style={{ backgroundColor: categoryColors[asset.category], display: 'inline-block' }} />
                          {categoryLabels[asset.category]}
                        </Badge>
                      </td>
                      <td className="py-3 text-right font-medium text-white">
                        {formatCurrency(asset.current_value)}
                      </td>
                      <td className="py-3 text-right text-gray-400">
                        {((asset.current_value / totalValue) * 100).toFixed(1)}%
                      </td>
                      <td className="py-3 text-right">
                        {asset.gainLossPct !== null ? (
                          <div className="flex items-center justify-end gap-1">
                            {asset.gainLossPct >= 0 ? (
                              <TrendingUp className="h-3 w-3 text-emerald-400" />
                            ) : (
                              <TrendingDown className="h-3 w-3 text-red-400" />
                            )}
                            <span className={asset.gainLossPct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                              {formatPercentage(asset.gainLossPct)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
