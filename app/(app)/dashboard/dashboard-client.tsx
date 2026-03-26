'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatPercentage } from '@/lib/utils'
import { spendingByCategory } from '@/lib/mock-data'
import type { Asset, Transaction, NetWorthEntry } from '@/lib/types'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'
import { HealthScore } from '@/components/health-score'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { TrendingUp, TrendingDown, DollarSign, Wallet, ArrowUpRight, ArrowDownRight, Info, Camera } from 'lucide-react'
import { snapshotNetWorth } from '@/lib/actions/networth'
import { useState, useTransition } from 'react'

interface Props {
  assets: Asset[]
  transactions: Transaction[]
  netWorthHistory: NetWorthEntry[]
  isDemo: boolean
}

function SnapshotButton({ totalAssets, totalLiabilities }: { totalAssets: number; totalLiabilities: number }) {
  const [isPending, startTransition] = useTransition()
  const [done, setDone] = useState(false)

  function handleSnapshot() {
    startTransition(async () => {
      await snapshotNetWorth(totalAssets, totalLiabilities)
      setDone(true)
      setTimeout(() => setDone(false), 3000)
    })
  }

  return (
    <button
      onClick={handleSnapshot}
      disabled={isPending}
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
    >
      <Camera className={`h-3.5 w-3.5 ${isPending ? 'animate-pulse' : ''}`} />
      {done ? 'Saved!' : isPending ? 'Saving...' : 'Snapshot Net Worth'}
    </button>
  )
}

export function DashboardClient({ assets, transactions, netWorthHistory, isDemo }: Props) {
  const totalAssets = assets.reduce((s, a) => s + a.current_value, 0)
  const totalLiabilities = 197000
  const netWorth = totalAssets - totalLiabilities

  const history = netWorthHistory
  const prevEntry = history.length >= 2 ? history[history.length - 2] : null
  const netWorthPrev = prevEntry?.net_worth ?? netWorth
  const netWorthChange = netWorth - netWorthPrev
  const netWorthChangePct = netWorthPrev > 0 ? (netWorthChange / netWorthPrev) * 100 : 0

  const monthlyIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const monthlyExpenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const savingsRate = monthlyIncome > 0 ? ((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100 : 0

  const stats = [
    {
      label: 'Net Worth',
      value: formatCurrency(netWorth),
      change: formatPercentage(netWorthChangePct),
      trend: netWorthChangePct >= 0 ? 'up' : 'down',
      sub: `${formatCurrency(Math.abs(netWorthChange))} ${netWorthChange >= 0 ? 'gain' : 'loss'} this month`,
      icon: DollarSign,
      color: 'text-indigo-400',
      bg: 'bg-indigo-500/10',
    },
    {
      label: 'Total Assets',
      value: formatCurrency(totalAssets),
      change: '+2.4%',
      trend: 'up',
      sub: `${assets.length} asset positions`,
      icon: TrendingUp,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
    {
      label: 'Monthly Income',
      value: formatCurrency(monthlyIncome),
      change: '+12.8%',
      trend: 'up',
      sub: `${transactions.filter(t => t.type === 'income').length} income entries`,
      icon: ArrowUpRight,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10',
    },
    {
      label: 'Savings Rate',
      value: `${savingsRate.toFixed(1)}%`,
      change: '+3.2%',
      trend: 'up',
      sub: `${formatCurrency(monthlyIncome - monthlyExpenses)} saved`,
      icon: Wallet,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
    },
  ]

  const chartData = history.map(e => ({
    month: e.date,
    netWorth: e.net_worth,
    assets: e.total_assets,
    liabilities: e.total_liabilities,
  }))

  // Build spending by category from real transactions
  const expensesByCategory = transactions
    .filter(t => t.type === 'expense')
    .reduce<Record<string, number>>((acc, t) => {
      acc[t.category] = (acc[t.category] ?? 0) + t.amount
      return acc
    }, {})

  const categoryColors = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#f97316', '#14b8a6']
  const spendingData = Object.entries(expensesByCategory).length > 0
    ? Object.entries(expensesByCategory)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, value], i) => ({ name, value, fill: categoryColors[i % categoryColors.length] }))
    : spendingByCategory

  return (
    <div className="p-6 space-y-6">
      {isDemo && <OnboardingWizard />}
      {isDemo && (
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-400">
            Showing <strong className="text-indigo-400">demo data</strong>. Add your assets, transactions, and goals to see your real financial picture.
          </p>
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map(({ label, value, change, trend, sub, icon: Icon, color, bg }) => (
          <Card key={label}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</p>
                <p className="mt-2 text-2xl font-bold text-white">{value}</p>
                <p className="mt-0.5 text-xs text-gray-500">{sub}</p>
              </div>
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${bg}`}>
                <Icon className={`h-5 w-5 ${color}`} />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              {trend === 'up' ? (
                <TrendingUp className="h-3 w-3 text-emerald-400" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-400" />
              )}
              <span className={`text-xs font-medium ${trend === 'up' ? 'text-emerald-400' : 'text-red-400'}`}>
                {change}
              </span>
              <span className="text-xs text-gray-600">vs last month</span>
            </div>
          </Card>
        ))}
      </div>

      {/* Financial Health Score */}
      <HealthScore
        assets={assets}
        transactions={transactions}
        savingsRate={savingsRate}
        totalAssets={totalAssets}
      />

      {/* Net Worth Chart + Spending */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Net Worth Over Time</CardTitle>
                <CardDescription>Assets vs. Liabilities</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {history.length >= 2 && (
                  <Badge variant={netWorthChange >= 0 ? 'success' : 'danger'}>
                    {formatPercentage(netWorthChangePct)} MoM
                  </Badge>
                )}
                <SnapshotButton totalAssets={totalAssets} totalLiabilities={totalLiabilities} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="netWorthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="assetsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                  labelStyle={{ color: '#9ca3af' }}
                  itemStyle={{ color: '#fff' }}
                  formatter={(value) => [formatCurrency(Number(value)), '']}
                />
                <Area type="monotone" dataKey="assets" stroke="#10b981" strokeWidth={1.5} fill="url(#assetsGrad)" name="Assets" />
                <Area type="monotone" dataKey="netWorth" stroke="#6366f1" strokeWidth={2} fill="url(#netWorthGrad)" name="Net Worth" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Spending Breakdown</CardTitle>
            <CardDescription>This month by category</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center mb-4">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie
                    data={spendingData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {spendingData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2">
              {spendingData.slice(0, 5).map((cat) => (
                <div key={cat.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cat.fill }} />
                    <span className="text-gray-400">{cat.name}</span>
                  </div>
                  <span className="text-white font-medium">{formatCurrency(cat.value)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Transactions */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Transactions</CardTitle>
          <CardDescription>Latest income and expenses</CardDescription>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-8">No transactions yet. Add some in the Budget page.</p>
          ) : (
            <div className="space-y-1">
              {transactions.slice(0, 10).map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${tx.type === 'income' ? 'bg-emerald-500/10' : 'bg-white/5'}`}>
                      {tx.type === 'income' ? (
                        <ArrowUpRight className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <ArrowDownRight className="h-4 w-4 text-gray-400" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{tx.description}</p>
                      <p className="text-xs text-gray-500">{tx.category} · {tx.date}</p>
                    </div>
                  </div>
                  <span className={`text-sm font-semibold ${tx.type === 'income' ? 'text-emerald-400' : 'text-white'}`}>
                    {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
