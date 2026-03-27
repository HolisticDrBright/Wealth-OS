'use client'

import type { BacktestJob, BacktestResult } from '@/lib/types'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine, BarChart, Bar, Cell,
} from 'recharts'

interface Props {
  job: BacktestJob
  result: BacktestResult | null
}

export function BacktestDetailClient({ job, result }: Props) {
  if (!result) {
    return (
      <div className="p-6">
        <Link href="/backtests" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-6">
          <ArrowLeft className="h-4 w-4" /> Back to Backtests
        </Link>
        <p className="text-gray-400">Results not yet available for this backtest.</p>
      </div>
    )
  }

  const kpis = [
    { label: 'Total Return', value: `${(result.total_return_pct ?? 0) >= 0 ? '+' : ''}${result.total_return_pct?.toFixed(2) ?? 0}%`, positive: (result.total_return_pct ?? 0) >= 0 },
    { label: 'Ann. Return', value: `${(result.annualized_return_pct ?? 0) >= 0 ? '+' : ''}${result.annualized_return_pct?.toFixed(2) ?? 0}%`, positive: (result.annualized_return_pct ?? 0) >= 0 },
    { label: 'vs Benchmark', value: `${((result.total_return_pct ?? 0) - (result.benchmark_return_pct ?? 0)) >= 0 ? '+' : ''}${((result.total_return_pct ?? 0) - (result.benchmark_return_pct ?? 0)).toFixed(2)}%`, positive: ((result.total_return_pct ?? 0) - (result.benchmark_return_pct ?? 0)) >= 0 },
    { label: 'Sharpe Ratio', value: result.sharpe_ratio?.toFixed(2) ?? '—', positive: (result.sharpe_ratio ?? 0) > 1 },
    { label: 'Sortino', value: result.sortino_ratio?.toFixed(2) ?? '—', positive: (result.sortino_ratio ?? 0) > 1 },
    { label: 'Max Drawdown', value: `-${result.max_drawdown_pct?.toFixed(2) ?? 0}%`, positive: false },
    { label: 'Win Rate', value: `${result.win_rate_pct?.toFixed(1) ?? 0}%`, positive: (result.win_rate_pct ?? 0) >= 50 },
    { label: 'Profit Factor', value: result.profit_factor?.toFixed(2) ?? '—', positive: (result.profit_factor ?? 0) >= 1 },
    { label: 'Alpha', value: `${(result.alpha ?? 0) >= 0 ? '+' : ''}${result.alpha?.toFixed(2) ?? 0}%`, positive: (result.alpha ?? 0) >= 0 },
    { label: 'Beta', value: result.beta?.toFixed(2) ?? '—', positive: true },
    { label: 'Total Trades', value: result.total_trades.toLocaleString(), positive: true },
    { label: 'Final Value', value: `$${(result.final_portfolio_value_usd ?? 0).toLocaleString()}`, positive: (result.final_portfolio_value_usd ?? 0) >= job.initial_capital_usd },
  ]

  // Monthly returns for bar chart
  const monthlyData = Object.entries(result.monthly_returns ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, ret]) => ({ month: month.slice(5), return: Math.round(ret * 100) / 100 }))

  // Equity curve — sample every N points for performance
  const equity = result.equity_curve ?? []
  const step = Math.max(1, Math.floor(equity.length / 300))
  const equitySampled = equity.filter((_, i) => i % step === 0)

  return (
    <div className="flex flex-col gap-6 p-6">
      <Link href="/backtests" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white w-fit">
        <ArrowLeft className="h-4 w-4" /> Back to Backtests
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-white mb-1">{job.name}</h1>
        <p className="text-sm text-gray-400">
          {job.symbols.join(', ')} · {job.start_date} → {job.end_date} · ${Number(job.initial_capital_usd).toLocaleString()} capital
        </p>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-4 gap-3">
        {kpis.map(k => (
          <div key={k.label} className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs text-gray-500 mb-1">{k.label}</p>
            <p className={cn('text-lg font-bold', k.positive ? 'text-green-400' : 'text-red-400')}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Equity curve */}
      {equitySampled.length > 1 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <p className="text-sm font-semibold text-gray-300 mb-4">Equity Curve vs Benchmark</p>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={equitySampled}>
              <defs>
                <linearGradient id="stratGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false}
                tickFormatter={d => d?.slice(5) ?? ''} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false}
                tickFormatter={v => `$${(Number(v)/1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: '#0a0b0f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                formatter={(v) => [`$${Number(v).toLocaleString()}`, '']}
              />
              <Area type="monotone" dataKey="value" name="Strategy" stroke="#6366f1" fill="url(#stratGrad)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="benchmark" name="Benchmark" stroke="#f59e0b" fill="none" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Monthly returns */}
      {monthlyData.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <p className="text-sm font-semibold text-gray-300 mb-4">Monthly Returns (%)</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false}
                tickFormatter={v => `${v}%`} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
              <Tooltip
                contentStyle={{ background: '#0a0b0f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                formatter={(v) => [`${Number(v).toFixed(2)}%`, 'Return']}
              />
              <Bar dataKey="return" radius={[2,2,0,0]}>
                {monthlyData.map((entry, index) => (
                  <Cell key={index} fill={entry.return >= 0 ? '#22c55e' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Trade stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Winning Trades</p>
          <p className="text-2xl font-bold text-green-400">{result.winning_trades}</p>
          <p className="text-xs text-gray-500 mt-1">avg ${result.avg_win_usd?.toFixed(0) ?? 0} gain</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Losing Trades</p>
          <p className="text-2xl font-bold text-red-400">{result.losing_trades}</p>
          <p className="text-xs text-gray-500 mt-1">avg ${result.avg_loss_usd?.toFixed(0) ?? 0} loss</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Max DD Duration</p>
          <p className="text-2xl font-bold text-white">{result.max_drawdown_duration_days ?? 0}</p>
          <p className="text-xs text-gray-500 mt-1">trading days</p>
        </div>
      </div>
    </div>
  )
}
