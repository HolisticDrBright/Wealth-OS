'use client'

import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { upsertTarget, updateSuggestionStatus } from '@/lib/actions/rebalance'
import { computeRebalanceTrades, DEFAULT_TARGETS } from '@/lib/rebalance-engine'
import { cn, formatCurrency } from '@/lib/utils'
import type { Asset, PortfolioTarget, RebalanceSuggestion } from '@/lib/types'
import { RefreshCw, TrendingUp, TrendingDown, CheckCircle2, XCircle, Play, Sparkles, AlertTriangle, Ban } from 'lucide-react'
import type { OptimizationStrategy } from '@/lib/optimizer'

/** Tax columns added by migration 20260610c — kept local to avoid touching shared types */
type TaxAwareSuggestion = RebalanceSuggestion & {
  tax_drag_usd?: number | null
  tax_warning?: string | null
  blocked_reason?: string | null
}

interface OptimizeResult {
  weights: Record<string, number>
  expectedReturn: number
  expectedVol: number
  sharpe: number
  strategy: OptimizationStrategy
}

interface Props {
  assets: Asset[]
  initialTargets: PortfolioTarget[]
  initialSuggestions: RebalanceSuggestion[]
}

const CLASS_COLORS: Record<string, string> = {
  stock: '#6366f1', crypto: '#f59e0b', bond: '#10b981',
  cash: '#6b7280', real_estate: '#ec4899', other: '#8b5cf6',
}

export function RebalanceClient({ assets, initialTargets, initialSuggestions }: Props) {
  const [targets, setTargets] = useState<Record<string, number>>(
    Object.fromEntries(
      (initialTargets.length ? initialTargets : DEFAULT_TARGETS).map(t => [t.asset_class, t.target_pct])
    )
  )
  const [suggestions, setSuggestions] = useState<TaxAwareSuggestion[]>(initialSuggestions)
  const [isRunning, setIsRunning] = useState(false)
  const [runMsg, setRunMsg] = useState<string | null>(null)
  const [isSaving, startSave] = useTransition()
  const [optimizeStrategy, setOptimizeStrategy] = useState<OptimizationStrategy>('mean_variance')
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)

  const totalValue = assets.reduce((s, a) => s + a.current_value, 0)
  const totalTargetPct = Object.values(targets).reduce((s, v) => s + v, 0)

  // Current allocation by class
  const currentByClass: Record<string, number> = {}
  for (const asset of assets) {
    const cls = asset.category
    currentByClass[cls] = (currentByClass[cls] ?? 0) + asset.current_value
  }

  function saveTargets() {
    startSave(async () => {
      await Promise.all(Object.entries(targets).map(([cls, pct]) => upsertTarget(cls, pct)))
    })
  }

  async function runRebalance(execute = false) {
    setIsRunning(true)
    setRunMsg(null)
    try {
      const res = await fetch('/api/rebalance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execute, threshold_pct: 5 }),
      })
      const envelope = await res.json()
      const data = envelope.data
      setSuggestions(data?.suggestions ?? [])
      setRunMsg(execute
        ? `Executed ${data?.executed ?? 0} rebalance trades`
        : `Found ${data?.trades?.length ?? 0} rebalancing opportunities`)
    } catch (err) {
      setRunMsg('Error running rebalance analysis')
    } finally {
      setIsRunning(false)
    }
  }

  async function runOptimizer() {
    const symbols = assets
      .filter(a => a.symbol && a.current_value > 0)
      .map(a => a.symbol!)
      .filter(Boolean)

    if (symbols.length < 2) {
      setOptimizeError('Need at least 2 symbols with price history to optimize')
      return
    }

    setIsOptimizing(true)
    setOptimizeError(null)
    setOptimizeResult(null)
    try {
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols, strategy: optimizeStrategy }),
      })
      const envelope = await res.json()
      if (!res.ok) {
        setOptimizeError(envelope.error ?? 'Optimization failed')
      } else {
        setOptimizeResult(envelope.data)
      }
    } catch {
      setOptimizeError('Error running optimizer')
    } finally {
      setIsOptimizing(false)
    }
  }

  function dismissSuggestion(id: string) {
    startSave(async () => {
      await updateSuggestionStatus(id, 'dismissed')
      setSuggestions(prev => prev.filter(s => s.id !== id))
    })
  }

  const pendingSuggestions = suggestions.filter(s => s.status === 'pending')

  return (
    <div className="space-y-6">
      {/* Current vs Target allocation */}
      <Card>
        <div className="p-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Allocation</p>
          <div className="space-y-3">
            {Object.entries(targets).map(([cls, targetPct]) => {
              const currentValue = currentByClass[cls] ?? 0
              const currentPct = totalValue > 0 ? (currentValue / totalValue) * 100 : 0
              const drift = currentPct - targetPct
              return (
                <div key={cls}>
                  <div className="flex items-center justify-between mb-1 text-xs">
                    <span className="text-white capitalize font-medium">{cls}</span>
                    <span className="text-gray-500">
                      {currentPct.toFixed(1)}% current / {targetPct}% target
                      {Math.abs(drift) >= 5 && (
                        <span className={`ml-2 ${drift > 0 ? 'text-red-400' : 'text-amber-400'}`}>
                          ({drift > 0 ? '+' : ''}{drift.toFixed(1)}% drift)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-white/10 relative overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full opacity-40"
                      style={{ width: `${Math.min(100, currentPct)}%`, backgroundColor: CLASS_COLORS[cls] ?? '#6366f1' }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 rounded-full border-r-2 border-white/60"
                      style={{ width: `${Math.min(100, targetPct)}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </Card>

      {/* Target editor */}
      <Card>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Target Allocation</p>
            <span className={`text-xs ${Math.abs(totalTargetPct - 100) > 0.1 ? 'text-red-400' : 'text-emerald-400'}`}>
              Total: {totalTargetPct.toFixed(1)}% {Math.abs(totalTargetPct - 100) > 0.1 ? '(must equal 100%)' : '✓'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Object.entries(targets).map(([cls, pct]) => (
              <Input
                key={cls}
                label={`${cls.charAt(0).toUpperCase() + cls.slice(1)} (%)`}
                type="number"
                min="0"
                max="100"
                value={pct}
                onChange={e => setTargets(t => ({ ...t, [cls]: Number(e.target.value) }))}
              />
            ))}
          </div>
          <div className="flex gap-3 mt-4">
            <Button onClick={saveTargets} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Targets'}
            </Button>
            <Button variant="outline" onClick={() => runRebalance(false)} disabled={isRunning}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRunning ? 'animate-spin' : ''}`} />
              {isRunning ? 'Analyzing...' : 'Analyze Drift'}
            </Button>
            <Button onClick={() => runRebalance(true)} disabled={isRunning || !pendingSuggestions.length}>
              <Play className="h-3.5 w-3.5 mr-1.5" />
              Execute Rebalance
            </Button>
          </div>
          {runMsg && <p className="text-xs text-emerald-400 mt-2">{runMsg}</p>}
        </div>
      </Card>

      {/* Portfolio Optimizer */}
      <Card>
        <div className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-4 w-4 text-indigo-400" />
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Portfolio Optimizer</p>
          </div>
          <div className="flex gap-3 items-end mb-4">
            <div className="flex-1">
              <Select
                label="Strategy"
                value={optimizeStrategy}
                onChange={e => setOptimizeStrategy(e.target.value as OptimizationStrategy)}
              >
                <option value="mean_variance">Mean-Variance (Max Sharpe)</option>
                <option value="risk_parity">Risk Parity</option>
                <option value="min_variance">Min Variance</option>
                <option value="equal_weight">Equal Weight</option>
              </Select>
            </div>
            <Button onClick={runOptimizer} disabled={isOptimizing}>
              <Sparkles className={`h-3.5 w-3.5 mr-1.5 ${isOptimizing ? 'animate-pulse' : ''}`} />
              {isOptimizing ? 'Optimizing...' : 'Optimize'}
            </Button>
          </div>
          {optimizeError && <p className="text-xs text-red-400 mb-3">{optimizeError}</p>}
          {optimizeResult && (
            <div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="rounded-lg bg-white/5 p-3">
                  <p className="text-xs text-gray-500">Expected Return</p>
                  <p className="text-sm font-bold text-emerald-400">{(optimizeResult.expectedReturn * 100).toFixed(1)}%</p>
                </div>
                <div className="rounded-lg bg-white/5 p-3">
                  <p className="text-xs text-gray-500">Expected Vol</p>
                  <p className="text-sm font-bold text-amber-400">{(optimizeResult.expectedVol * 100).toFixed(1)}%</p>
                </div>
                <div className="rounded-lg bg-white/5 p-3">
                  <p className="text-xs text-gray-500">Sharpe Ratio</p>
                  <p className="text-sm font-bold text-white">{optimizeResult.sharpe.toFixed(2)}</p>
                </div>
              </div>
              <p className="text-xs text-gray-500 mb-2">Recommended weights:</p>
              <div className="space-y-1.5">
                {Object.entries(optimizeResult.weights)
                  .sort((a, b) => b[1] - a[1])
                  .map(([symbol, weight]) => (
                    <div key={symbol} className="flex items-center gap-3">
                      <span className="text-xs font-medium text-white w-16 shrink-0">{symbol}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-white/10">
                        <div
                          className="h-1.5 rounded-full bg-indigo-500"
                          style={{ width: `${Math.min(100, weight * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-400 w-12 text-right">{(weight * 100).toFixed(1)}%</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Suggestions */}
      {pendingSuggestions.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Suggested Trades</h2>
          <div className="space-y-2">
            {pendingSuggestions.map(s => (
              <Card key={s.id}>
                <div className={cn('p-4', s.blocked_reason && 'opacity-80')}>
                  <div className="flex items-center gap-4">
                    {s.blocked_reason
                      ? <Ban className="h-5 w-5 text-amber-400 shrink-0" />
                      : s.action === 'buy'
                        ? <TrendingUp className="h-5 w-5 text-emerald-400 shrink-0" />
                        : <TrendingDown className="h-5 w-5 text-red-400 shrink-0" />}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white capitalize">
                          {s.action.toUpperCase()} {s.asset_class}
                        </p>
                        {s.tax_warning === 'short_term_gains' && (
                          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium">
                            <AlertTriangle className="h-3 w-3" />
                            Sells short-term gains
                          </span>
                        )}
                        {s.tax_warning === 'harvests_losses' && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium">
                            Harvests losses
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {s.current_pct?.toFixed(1)}% → {s.target_pct?.toFixed(1)}%
                        · Drift: {s.drift_pct && s.drift_pct > 0 ? '+' : ''}{s.drift_pct?.toFixed(1)}%
                        {s.action === 'sell' && s.tax_drag_usd != null && (
                          <span className={cn('ml-2', s.tax_drag_usd > 0 ? 'text-amber-400' : 'text-emerald-400')}>
                            · Est. tax drag: {formatCurrency(s.tax_drag_usd)}
                          </span>
                        )}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-white">{formatCurrency(s.suggested_notional ?? 0)}</p>
                    <button onClick={() => dismissSuggestion(s.id)} className="text-gray-600 hover:text-gray-400">
                      <XCircle className="h-4 w-4" />
                    </button>
                  </div>
                  {s.blocked_reason && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-200/80">{s.blocked_reason}</p>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
