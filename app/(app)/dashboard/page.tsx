'use client'

import { Topbar } from '@/components/layout/topbar'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatPercentage } from '@/lib/utils'
import {
  mockNetWorthHistory,
  mockAssets,
  mockTransactions,
  spendingByCategory,
} from '@/lib/mock-data'
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
import { TrendingUp, TrendingDown, DollarSign, Wallet, ArrowUpRight, ArrowDownRight } from 'lucide-react'

const totalAssets = mockAssets.reduce((s, a) => s + a.current_value, 0)
const totalLiabilities = 197000
const netWorth = totalAssets - totalLiabilities
const netWorthPrev = mockNetWorthHistory[mockNetWorthHistory.length - 2].net_worth
const netWorthChange = netWorth - netWorthPrev
const netWorthChangePct = (netWorthChange / netWorthPrev) * 100

const monthlyIncome = mockTransactions
  .filter(t => t.type === 'income')
  .reduce((s, t) => s + t.amount, 0)
const monthlyExpenses = mockTransactions
  .filter(t => t.type === 'expense')
  .reduce((s, t) => s + t.amount, 0)
const savingsRate = ((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100

const stats = [
  {
    label: 'Net Worth',
    value: formatCurrency(netWorth),
    change: formatPercentage(netWorthChangePct),
    trend: 'up',
    sub: `${formatCurrency(netWorthChange)} this month`,
    icon: DollarSign,
    color: 'text-indigo-400',
    bg: 'bg-indigo-500/10',
  },
  {
    label: 'Total Assets',
    value: formatCurrency(totalAssets),
    change: '+2.4%',
    trend: 'up',
    sub: '10 asset positions',
    icon: TrendingUp,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
  {
    label: 'Monthly Income',
    value: formatCurrency(monthlyIncome),
    change: '+12.8%',
    trend: 'up',
    sub: 'Salary + freelance + dividends',
    icon: ArrowUpRight,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
  },
  {
    label: 'Savings Rate',
    value: `${savingsRate.toFixed(1)}%`,
    change: '+3.2%',
    trend: 'up',
    sub: `${formatCurrency(monthlyIncome - monthlyExpenses)} saved this month`,
    icon: Wallet,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
  },
]

export default function DashboardPage() {
  const chartData = mockNetWorthHistory.map(e => ({
    month: e.date,
    netWorth: e.net_worth,
    assets: e.total_assets,
    liabilities: e.total_liabilities,
  }))

  const recentTransactions = mockTransactions.slice(0, 8)

  return (
    <div>
      <Topbar title="Dashboard" subtitle="March 2026 — Financial Overview" />

      <div className="p-6 space-y-6">
        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {stats.map(({ label, value, change, trend, sub, icon: Icon, color, bg }) => (
            <Card key={label} className="relative overflow-hidden">
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

        {/* Net Worth Chart + Spending */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Net Worth Over Time</CardTitle>
                  <CardDescription>Assets vs. Liabilities — 7 months</CardDescription>
                </div>
                <Badge variant="success">+{formatPercentage(53.5)} YTD</Badge>
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
                      data={spendingByCategory}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {spendingByCategory.map((entry, index) => (
                        <Cell key={index} fill={entry.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2">
                {spendingByCategory.slice(0, 5).map((cat) => (
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
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Recent Transactions</CardTitle>
                <CardDescription>Latest income and expenses</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {recentTransactions.map((tx) => (
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
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
