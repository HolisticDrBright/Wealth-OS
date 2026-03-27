'use client'

import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { upsertTarget, updateSuggestionStatus } from '@/lib/actions/rebalance'
import { computeRebalanceTrades, DEFAULT_TARGETS } from '@/lib/rebalance-engine'
import { formatCurrency } from '@/lib/utils'
import type { Asset, PortfolioTarget, RebalanceSuggestion } from '@/lib/types'
import { RefreshCw, TrendingUp, TrendingDown, CheckCircle2, XCircle, Play } from 'lucide-react'

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
  const [suggestions, setSuggestions] = useState(initialSuggestions)
  const [isRunning, setIsRunning] = useState(false)
  const [runMsg, setRunMsg] = useState<string | null>(null)
  const [isSaving, startSave] = useTransition()

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

      {/* Suggestions */}
      {pendingSuggestions.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Suggested Trades</h2>
          <div className="space-y-2">
            {pendingSuggestions.map(s => (
              <Card key={s.id}>
                <div className="flex items-center gap-4 p-4">
                  {s.action === 'buy'
                    ? <TrendingUp className="h-5 w-5 text-emerald-400 shrink-0" />
                    : <TrendingDown className="h-5 w-5 text-red-400 shrink-0" />}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white capitalize">
                      {s.action.toUpperCase()} {s.asset_class}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {s.current_pct?.toFixed(1)}% → {s.target_pct?.toFixed(1)}%
                      · Drift: {s.drift_pct && s.drift_pct > 0 ? '+' : ''}{s.drift_pct?.toFixed(1)}%
                    </p>
                  </div>
                  <p className="text-sm font-bold text-white">{formatCurrency(s.suggested_notional ?? 0)}</p>
                  <button onClick={() => dismissSuggestion(s.id)} className="text-gray-600 hover:text-gray-400">
                    <XCircle className="h-4 w-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
