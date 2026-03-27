'use client'

import { useState, useTransition } from 'react'
import { createBacktestJob, deleteBacktestJob } from '@/lib/actions/backtests'
import type { BacktestJob } from '@/lib/types'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { FlaskConical, Plus, Trash2, CheckCircle, Clock, XCircle, RefreshCw, ChevronRight } from 'lucide-react'

interface Props { initialJobs: BacktestJob[] }

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending:   { label: 'Pending',   color: 'text-yellow-400 bg-yellow-400/10', icon: Clock },
  running:   { label: 'Running',   color: 'text-blue-400 bg-blue-400/10',    icon: RefreshCw },
  completed: { label: 'Complete',  color: 'text-green-400 bg-green-400/10',  icon: CheckCircle },
  failed:    { label: 'Failed',    color: 'text-red-400 bg-red-400/10',      icon: XCircle },
}

const FREQ_LABELS: Record<string, string> = {
  none: 'Buy & Hold', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
}

export function BacktestsClient({ initialJobs }: Props) {
  const [jobs, setJobs] = useState(initialJobs)
  const [showForm, setShowForm] = useState(false)
  const [pending, startTransition] = useTransition()
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [symbolsRaw, setSymbolsRaw] = useState('AAPL,MSFT,GOOGL,AMZN,NVDA')
  const [startDate, setStartDate] = useState('2022-01-01')
  const [endDate, setEndDate] = useState('2024-12-31')
  const [capital, setCapital] = useState('100000')
  const [freq, setFreq] = useState<BacktestJob['rebalance_frequency']>('monthly')
  const [benchmark, setBenchmark] = useState('SPY')

  async function handleRun() {
    if (!name.trim()) return
    setRunning(true)
    setRunError(null)
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          symbols: symbolsRaw.split(',').map(s => s.trim()).filter(Boolean),
          start_date: startDate,
          end_date: endDate,
          initial_capital_usd: Number(capital),
          rebalance_frequency: freq,
          benchmark_symbol: benchmark,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setRunError(data.error ?? 'Backtest failed')
      } else {
        setJobs(prev => [data.data.job, ...prev])
        setShowForm(false)
        setName('')
      }
    } catch (e) {
      setRunError('Network error')
    } finally {
      setRunning(false)
    }
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteBacktestJob(id)
      setJobs(prev => prev.filter(j => j.id !== id))
    })
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Backtests</h1>
          <p className="text-sm text-gray-400 mt-1">Run strategy simulations on historical data</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Backtest
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-5 flex flex-col gap-4">
          <p className="font-semibold text-white">Configure Backtest</p>
          <p className="text-xs text-gray-500">Uses momentum-based signal with equal-weight allocation. Synthetic price data is generated when no market data provider is configured.</p>

          {runError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">{runError}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. FAANG Momentum 2022-2024"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Symbols (comma-separated)</label>
              <input value={symbolsRaw} onChange={e => setSymbolsRaw(e.target.value)} placeholder="AAPL, MSFT, GOOGL"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Start Date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">End Date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Initial Capital ($)</label>
              <input type="number" value={capital} onChange={e => setCapital(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Rebalance Frequency</label>
              <select value={freq} onChange={e => setFreq(e.target.value as BacktestJob['rebalance_frequency'])}
                className="w-full rounded-lg border border-white/10 bg-[#0a0b0f] px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                <option value="none">Buy &amp; Hold</option>
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
                <option value="daily">Daily</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Benchmark</label>
              <input value={benchmark} onChange={e => setBenchmark(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={handleRun} disabled={running || !name.trim()}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 flex items-center gap-2">
              {running && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              Run Backtest
            </button>
            <button onClick={() => { setShowForm(false); setRunError(null) }}
              className="px-4 py-2 rounded-lg bg-white/5 text-sm text-gray-300 hover:bg-white/10">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Job list */}
      {jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <FlaskConical className="h-10 w-10 mb-3 opacity-30" />
          <p>No backtests yet</p>
          <p className="text-sm mt-1">Run a backtest to evaluate strategy performance on historical data</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {jobs.map(job => {
            const cfg = STATUS_CONFIG[job.status]
            const Icon = cfg.icon
            return (
              <div key={job.id} className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-medium text-white truncate">{job.name}</p>
                    <span className={cn('inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium', cfg.color)}>
                      <Icon className={cn('h-3 w-3', job.status === 'running' && 'animate-spin')} />
                      {cfg.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>{job.symbols.slice(0,4).join(', ')}{job.symbols.length > 4 ? ` +${job.symbols.length - 4}` : ''}</span>
                    <span>·</span>
                    <span>{job.start_date} → {job.end_date}</span>
                    <span>·</span>
                    <span>${Number(job.initial_capital_usd).toLocaleString()} capital</span>
                    <span>·</span>
                    <span>{FREQ_LABELS[job.rebalance_frequency] ?? job.rebalance_frequency}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {job.status === 'completed' && (
                    <Link href={`/backtests/${job.id}`} className="text-gray-500 hover:text-white transition-colors">
                      <ChevronRight className="h-5 w-5" />
                    </Link>
                  )}
                  <button onClick={() => handleDelete(job.id)} disabled={pending}
                    className="text-gray-600 hover:text-red-400 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
