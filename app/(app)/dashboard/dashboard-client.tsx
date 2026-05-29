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
import { TrendingUp, TrendingDown, DollarSign, Wallet, ArrowUpRight, ArrowDownRight, Info, Camera, MessageCircle, X, Send, Bot, FlaskConical } from 'lucide-react'
import { snapshotNetWorth } from '@/lib/actions/networth'
import { useState, useTransition, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

function PortfolioChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  async function send() {
    const msg = input.trim()
    if (!msg || streaming) return
    setInput('')
    const newHistory: ChatMessage[] = [...messages, { role: 'user', content: msg }]
    setMessages(newHistory)
    setStreaming(true)
    setMessages(h => [...h, { role: 'assistant', content: '' }])

    try {
      const res = await fetch('/api/portfolio-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          conversationHistory: messages.slice(-10),
        }),
      })

      if (!res.ok || !res.body) {
        setMessages(h => h.map((m, i) => i === h.length - 1 ? { ...m, content: 'Error: could not get response.' } : m))
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        full += decoder.decode(value, { stream: true })
        setMessages(h => h.map((m, i) => i === h.length - 1 ? { ...m, content: full } : m))
      }
    } catch {
      setMessages(h => h.map((m, i) => i === h.length - 1 ? { ...m, content: 'Error: connection failed.' } : m))
    } finally {
      setStreaming(false)
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 shadow-lg hover:bg-indigo-500 transition-colors"
      >
        {open ? <X className="h-6 w-6 text-white" /> : <MessageCircle className="h-6 w-6 text-white" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-96 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-line bg-bg-0 shadow-2xl flex flex-col overflow-hidden" style={{ height: '28rem' }}>
          <div className="flex items-center gap-3 px-4 py-3 border-b border-line bg-bg-3 shrink-0">
            <Bot className="h-5 w-5 text-indigo-400" />
            <p className="text-sm font-semibold text-text-0">Portfolio Assistant</p>
            <p className="text-xs text-text-2 ml-auto">Ask about your portfolio</p>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center text-xs text-text-2 py-8">
                <Bot className="h-8 w-8 text-text-3 mx-auto mb-2" />
                <p>Ask me anything about your portfolio.</p>
                <p className="mt-1">Try: &quot;What&apos;s my biggest position?&quot; or &quot;How diversified am I?&quot;</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-br-sm'
                    : 'bg-bg-3 text-text-1 rounded-bl-sm'
                }`}>
                  {m.content || (streaming && i === messages.length - 1 ? <span className="animate-pulse">▋</span> : '')}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <div className="flex gap-2 p-3 border-t border-white/10 shrink-0">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder="Ask about your portfolio..."
              disabled={streaming}
              className="flex-1 rounded-lg bg-bg-3 border border-line px-3 py-2 text-sm text-text-0 placeholder-text-3 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={streaming || !input.trim()}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 transition-colors"
            >
              <Send className="h-4 w-4 text-white" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}

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
  const latestEntry = netWorthHistory.length > 0 ? netWorthHistory[netWorthHistory.length - 1] : null
  const totalLiabilities = latestEntry?.total_liabilities ?? 0
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
    <div className="p-6 space-y-6 bg-bg-1 min-h-full">
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
                <p className="text-xs font-medium text-text-2 uppercase tracking-wider">{label}</p>
                <p className="mt-2 text-2xl font-bold text-text-0">{value}</p>
                <p className="mt-0.5 text-xs text-text-2">{sub}</p>
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
              <span className="text-xs text-text-3">vs last month</span>
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
                <XAxis dataKey="month" tick={{ fill: 'var(--color-text-2)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fill: 'var(--color-text-2)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--color-bg-0)', border: '1px solid var(--color-line)', borderRadius: '8px' }}
                  labelStyle={{ color: 'var(--color-text-2)' }}
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
            <p className="text-center text-sm text-text-2 py-8">No transactions yet. Add some in the Budget page.</p>
          ) : (
            <div className="space-y-1">
              {transactions.slice(0, 10).map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-bg-3 transition-colors"
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
                      <p className="text-sm font-medium text-text-0">{tx.description}</p>
                      <p className="text-xs text-text-2">{tx.category} · {tx.date}</p>
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

      <PortfolioChat />

      {/* Paper Positions overview */}
      <PaperPositionsCard />

      {/* Research Terminal card — Fincept Terminal */}
      <Card className="border-border/40 bg-muted/20">
        <CardContent className="flex items-center justify-between p-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Research Terminal</p>
            <p className="text-xs text-muted-foreground">
              Manual research companion — Fincept Terminal (open source desktop app)
            </p>
          </div>
          <a
            href="https://github.com/Fincept-Corporation/FinceptTerminal"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            onClick={() => {
              fetch('/api/telemetry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event: 'fincept_terminal_click', properties: { source: 'dashboard' } }),
              }).catch(() => {})
            }}
          >
            Open GitHub
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Paper Positions Card ────────────────────────────────────────────────────

interface PaperPos {
  id: string
  strategy_key: string
  symbol: string
  direction?: string
  side?: string
  quantity: number
  entry_price: number
  current_price: number | null
  unrealized_pnl_usd?: number | null
  unrealized_pnl?: number | null
  asset_class: string
}

interface PaperStats {
  closedTrades: number
  openPositions: number
  winRate: number | null
  totalRealizedPnlUsd: number
  totalUnrealizedPnlUsd: number
  totalPnlUsd: number
  avgWinUsd: number | null
  avgLossUsd: number | null
}

const ASSET_PAGE: Record<string, string> = {
  crypto: '/crypto',
  forex: '/forex',
  options: '/options',
  polymarket: '/polymarket',
  stocks: '/portfolio',
  'multi-asset': '/crypto',
}

function PaperPositionsCard() {
  const [positions, setPositions] = useState<PaperPos[]>([])
  const [stats, setStats] = useState<PaperStats | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [posRes, sumRes] = await Promise.all([
        fetch('/api/paper-trading/positions'),
        fetch('/api/paper-trading/summary'),
      ])
      if (posRes.ok) {
        const data = await posRes.json()
        setPositions(data.open ?? data.openPositions ?? [])
      }
      if (sumRes.ok) {
        setStats(await sumRes.json())
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const wins   = stats ? Math.round((stats.winRate ?? 0) * stats.closedTrades) : 0
  const losses = stats ? stats.closedTrades - wins : 0
  const totalPnl = stats?.totalPnlUsd ?? 0

  return (
    <Card className="border-border/40 bg-muted/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-indigo-400" />
            <CardTitle className="text-sm font-medium">Paper Positions</CardTitle>
          </div>
          <Badge variant="default" className="text-xs">
            {loading ? '…' : positions.length} open
          </Badge>
        </div>
        <CardDescription className="text-xs">
          Simulated trades across all asset classes
        </CardDescription>
      </CardHeader>
      {/* Stats row — always visible once loaded */}
      {!loading && stats && (
        <div className="px-6 pb-3 grid grid-cols-4 gap-2">
          <div className="rounded-lg bg-background/60 border border-border/30 px-3 py-2 text-center">
            <p className="text-xs text-muted-foreground">Closed</p>
            <p className="text-sm font-semibold">{stats.closedTrades}</p>
          </div>
          <div className="rounded-lg bg-background/60 border border-border/30 px-3 py-2 text-center">
            <p className="text-xs text-muted-foreground">W / L</p>
            <p className="text-sm font-semibold">
              {stats.closedTrades > 0 ? (
                <>
                  <span className="text-green-400">{wins}</span>
                  <span className="text-muted-foreground mx-0.5">/</span>
                  <span className="text-red-400">{losses}</span>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
          </div>
          <div className="rounded-lg bg-background/60 border border-border/30 px-3 py-2 text-center">
            <p className="text-xs text-muted-foreground">Win Rate</p>
            <p className="text-sm font-semibold">
              {stats.winRate != null ? `${(stats.winRate * 100).toFixed(0)}%` : '—'}
            </p>
          </div>
          <div className="rounded-lg bg-background/60 border border-border/30 px-3 py-2 text-center">
            <p className="text-xs text-muted-foreground">Realized P&L</p>
            <p className={`text-sm font-semibold font-mono ${(stats.totalRealizedPnlUsd ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {stats.closedTrades > 0
                ? `${(stats.totalRealizedPnlUsd ?? 0) >= 0 ? '+' : ''}$${(stats.totalRealizedPnlUsd ?? 0).toFixed(2)}`
                : '—'}
            </p>
          </div>
        </div>
      )}
      <CardContent className="pt-0">
        {loading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Loading…</p>
        ) : positions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="text-xs text-muted-foreground">No open paper positions</p>
            <p className="text-xs text-muted-foreground/60">
              Enable Paper switches on the{' '}
              <Link href="/crypto" className="text-primary hover:underline">Crypto</Link>,{' '}
              <Link href="/forex" className="text-primary hover:underline">Forex</Link>, or{' '}
              <Link href="/options" className="text-primary hover:underline">Options</Link> pages, then run a pass.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {positions.slice(0, 8).map(pos => {
              const pnl = pos.unrealized_pnl_usd ?? pos.unrealized_pnl ?? 0
              const page = ASSET_PAGE[pos.asset_class] ?? '/crypto'
              return (
                <div key={pos.id} className="flex items-center justify-between text-xs rounded-lg border border-border/40 bg-background/40 px-3 py-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <Link href={page} className="font-mono font-medium text-foreground hover:text-primary truncate">
                      {pos.symbol}
                    </Link>
                    <span className={`px-1.5 py-0.5 rounded-full font-medium ${
                      (pos.direction ?? pos.side) === 'long' ? 'text-green-400 bg-green-400/10' : 'text-red-400 bg-red-400/10'
                    }`}>
                      {(pos.direction ?? pos.side ?? '').toUpperCase()}
                    </span>
                    <span className="text-muted-foreground truncate hidden sm:block">
                      {(pos.strategy_key ?? '').replace(/_/g, ' ')}
                    </span>
                  </div>
                  <span className={`font-mono font-semibold shrink-0 ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                  </span>
                </div>
              )
            })}
            {positions.length > 8 && (
              <p className="text-xs text-muted-foreground text-center pt-1">
                +{positions.length - 8} more — view on asset pages
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
