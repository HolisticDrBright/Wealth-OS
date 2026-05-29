'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Brain, RefreshCw, TrendingUp, TrendingDown, CheckCircle2, AlertCircle, BarChart2, Zap, Info } from 'lucide-react'
import type { StrategyStats } from '@/lib/learning/types'
import { AgentTrustBoard } from '@/components/calibration/AgentTrustBoard'
import type { AgentTrust } from '@/lib/actions/agent-trust'

interface Props {
  initialWeights: Record<string, number>
  initialStats: StrategyStats[]
  totalDecisions: number
  totalOutcomes: number
  pendingGrade: number
  agents: AgentTrust[]
}

const STRATEGY_COLORS: Record<string, string> = {
  combined:  '#6366f1',
  kronos:    '#8b5cf6',
  mirofish:  '#ec4899',
  momentum:  '#f59e0b',
  sentiment: '#10b981',
}

function formatPct(v: number | null, decimals = 1): string {
  if (v == null) return '—'
  return `${(v * 100).toFixed(decimals)}%`
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-gray-600 text-xs">—</span>
  const color = score > 1 ? 'text-emerald-400' : score > 0 ? 'text-amber-400' : 'text-red-400'
  return <span className={`font-mono text-sm font-bold ${color}`}>{score > 0 ? '+' : ''}{score.toFixed(2)}</span>
}

export function LearningClient({ initialWeights, initialStats, totalDecisions, totalOutcomes, pendingGrade, agents }: Props) {
  const [weights, setWeights] = useState(initialWeights)
  const [stats, setStats] = useState(initialStats)
  const [decisions, setDecisions] = useState(totalDecisions)
  const [outcomes, setOutcomes] = useState(totalOutcomes)
  const [pending, setPending] = useState(pendingGrade)
  const [isRunning, setIsRunning] = useState(false)
  const [isBackfilling, setIsBackfilling] = useState(false)
  const [lastResult, setLastResult] = useState<{
    updated: boolean
    reason: string
    graded?: number
    max_delta?: number
  } | null>(null)
  const [backfillResult, setBackfillResult] = useState<{ openBackfilled: number; closedBackfilled: number; skipped: number; total: number } | null>(null)

  async function backfill() {
    setIsBackfilling(true)
    setBackfillResult(null)
    try {
      const res = await fetch('/api/learning/backfill', { method: 'POST' })
      const data = await res.json()
      setBackfillResult(data)
      // Refresh counts
      const statsRes = await fetch('/api/learning')
      const statsData = (await statsRes.json()).data
      if (statsData) {
        setDecisions(statsData.total_decisions)
        setPending(statsData.pending_grade)
      }
    } catch {
      setBackfillResult({ openBackfilled: 0, closedBackfilled: 0, skipped: 0, total: 0 })
    } finally {
      setIsBackfilling(false)
    }
  }

  async function runPass() {
    setIsRunning(true)
    setLastResult(null)
    try {
      const res = await fetch('/api/learning', { method: 'POST' })
      const envelope = await res.json()
      const data = envelope.data

      setLastResult({ updated: data.updated, reason: data.reason, graded: data.graded, max_delta: data.max_delta })

      if (data.weights) setWeights(data.weights)
      if (data.scores) {
        setStats(data.scores.map((s: StrategyStats & { current_weight?: number }) => ({
          ...s,
          current_weight: data.weights?.[s.strategy] ?? null,
        })))
      }

      // Refresh stats from GET
      const statsRes = await fetch('/api/learning')
      const statsData = (await statsRes.json()).data
      if (statsData) {
        setDecisions(statsData.total_decisions)
        setOutcomes(statsData.total_outcomes)
        setPending(statsData.pending_grade)
        if (statsData.stats?.length) setStats(statsData.stats)
      }
    } catch {
      setLastResult({ updated: false, reason: 'Connection error' })
    } finally {
      setIsRunning(false)
    }
  }

  const sortedWeights = Object.entries(weights).sort((a, b) => b[1] - a[1])

  // De-emphasize unexplained weights: a weight is only "learned" once its
  // strategy has accumulated enough graded outcomes (the loop requires 20+).
  // Below that, the number is still the default prior, not evidence — flag it
  // as "shadow" so a raw percentage isn't read as an authoritative track record.
  const LEARN_THRESHOLD = 20
  const gradedByStrategy = new Map(stats.map(s => [s.strategy, s.count]))
  const isLearnedWeight = (strategy: string) => (gradedByStrategy.get(strategy) ?? 0) >= LEARN_THRESHOLD

  return (
    <div className="space-y-6">
      {/* Stats overview */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Decisions', value: decisions.toLocaleString(), icon: Brain, color: 'text-indigo-400' },
          { label: 'Graded Outcomes', value: outcomes.toLocaleString(), icon: CheckCircle2, color: 'text-emerald-400' },
          { label: 'Pending Grade', value: pending.toLocaleString(), icon: AlertCircle, color: pending > 0 ? 'text-amber-400' : 'text-gray-500' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <div className="p-4 flex items-center gap-3">
              <Icon className={`h-5 w-5 shrink-0 ${color}`} />
              <div>
                <p className="text-xs text-gray-500">{label}</p>
                <p className="text-lg font-bold text-white">{value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Agent trust / calibration */}
      <AgentTrustBoard agents={agents} />

      {/* Learning pass trigger */}
      <Card>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-white">Run Learning Pass</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Grades pending outcomes using real price data, then updates strategy weights
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={backfill} disabled={isBackfilling}>
                <BarChart2 className={`h-3.5 w-3.5 mr-1.5 ${isBackfilling ? 'animate-pulse' : ''}`} />
                {isBackfilling ? 'Backfilling...' : 'Backfill History'}
              </Button>
              <Button onClick={runPass} disabled={isRunning}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRunning ? 'animate-spin' : ''}`} />
                {isRunning ? 'Running...' : 'Run Now'}
              </Button>
            </div>
          </div>
          {backfillResult && (
            <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-4 py-3 flex items-center gap-3 mb-4">
              <CheckCircle2 className="h-4 w-4 text-indigo-400 shrink-0" />
              <div className="text-sm text-indigo-300">
                <p>Backfilled {backfillResult.total} position{backfillResult.total !== 1 ? 's' : ''} total</p>
                {backfillResult.closedBackfilled > 0 && (
                  <p className="text-xs text-indigo-400 mt-0.5">
                    {backfillResult.closedBackfilled} closed trades → outcome_log (ready to learn from now)
                  </p>
                )}
                {backfillResult.openBackfilled > 0 && (
                  <p className="text-xs text-indigo-400 mt-0.5">
                    {backfillResult.openBackfilled} open positions → decision_log (pending grade on close)
                  </p>
                )}
                {backfillResult.skipped > 0 && (
                  <p className="text-xs text-indigo-400/60 mt-0.5">{backfillResult.skipped} already logged, skipped</p>
                )}
              </div>
            </div>
          )}

          {lastResult && (
            <div className={`rounded-lg border px-4 py-3 flex items-start gap-3 ${
              lastResult.updated
                ? 'border-emerald-500/20 bg-emerald-500/10'
                : 'border-white/10 bg-white/5'
            }`}>
              {lastResult.updated
                ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                : <AlertCircle className="h-4 w-4 text-gray-500 shrink-0 mt-0.5" />
              }
              <div className="text-sm">
                <p className={lastResult.updated ? 'text-emerald-300' : 'text-gray-400'}>{lastResult.reason}</p>
                {lastResult.graded != null && lastResult.graded > 0 && (
                  <p className="text-xs text-gray-500 mt-0.5">Graded {lastResult.graded} new outcome{lastResult.graded !== 1 ? 's' : ''}</p>
                )}
                {lastResult.max_delta != null && (
                  <p className="text-xs text-gray-500 mt-0.5">Max weight change: {(lastResult.max_delta * 100).toFixed(1)}%</p>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Active weights */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Active Strategy Weights</h2>
        <Card>
          <div className="p-6 space-y-4">
            {sortedWeights.map(([strategy, weight]) => {
              const learned = isLearnedWeight(strategy)
              const graded = gradedByStrategy.get(strategy) ?? 0
              return (
              <div key={strategy}>
                <div className="flex items-center justify-between mb-1.5 text-xs gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: STRATEGY_COLORS[strategy] ?? '#6b7280' }}
                    />
                    <span className="font-medium text-white capitalize truncate">{strategy}</span>
                    {!learned && (
                      <span
                        title={`Default prior, not yet learned — only ${graded} graded outcome${graded === 1 ? '' : 's'} (needs ${LEARN_THRESHOLD}+). This weight is not an authoritative track record.`}
                        className="inline-flex items-center gap-1 rounded-md border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-sky-400 shrink-0"
                      >
                        <Info className="h-2.5 w-2.5" /> shadow
                      </span>
                    )}
                  </div>
                  <span
                    className="text-gray-400 font-mono shrink-0"
                    title={learned ? `Learned from ${graded} graded outcomes` : 'Default prior — not yet learned from outcomes'}
                  >
                    {(weight * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-white/10">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, weight * 100)}%`,
                      backgroundColor: STRATEGY_COLORS[strategy] ?? '#6366f1',
                    }}
                  />
                </div>
              </div>
              )
            })}
            <p className="text-xs text-gray-600 pt-2">
              Weights are updated automatically when strategies accumulate 20+ graded outcomes.
              A <span className="text-sky-400">shadow</span> tag marks weights still at their
              default prior — shown for context, not as an authoritative track record.
              Max change: 8% per pass. Floors protect strategies with asymmetric P&L.
            </p>
          </div>
        </Card>
      </div>

      {/* Strategy performance table */}
      {stats.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Strategy Performance</h2>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-xs text-gray-500">
                    <th className="text-left px-4 py-3 font-medium">Strategy</th>
                    <th className="text-right px-4 py-3 font-medium">Outcomes</th>
                    <th className="text-right px-4 py-3 font-medium">Brier ↓</th>
                    <th className="text-right px-4 py-3 font-medium">Hit Rate</th>
                    <th className="text-right px-4 py-3 font-medium">Avg Alpha</th>
                    <th className="text-right px-4 py-3 font-medium">Score ↑</th>
                    <th className="text-right px-4 py-3 font-medium">Weight</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {stats.map(s => (
                    <tr key={s.strategy} className="hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: STRATEGY_COLORS[s.strategy] ?? '#6b7280' }}
                          />
                          <span className="font-medium text-white capitalize">{s.strategy}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400">{s.count}</td>
                      <td className="px-4 py-3 text-right">
                        {s.brier == null ? (
                          <span className="text-gray-600 text-xs">—</span>
                        ) : (
                          <span className={s.brier < 0.20 ? 'text-emerald-400' : s.brier < 0.24 ? 'text-amber-400' : 'text-red-400'}>
                            {s.brier.toFixed(3)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {s.hit_rate == null ? (
                          <span className="text-gray-600 text-xs">—</span>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            {s.hit_rate >= 0.5
                              ? <TrendingUp className="h-3 w-3 text-emerald-400" />
                              : <TrendingDown className="h-3 w-3 text-red-400" />
                            }
                            <span className={s.hit_rate >= 0.55 ? 'text-emerald-400' : s.hit_rate >= 0.45 ? 'text-gray-300' : 'text-red-400'}>
                              {formatPct(s.hit_rate)}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {s.avg_alpha == null ? (
                          <span className="text-gray-600 text-xs">—</span>
                        ) : (
                          <span className={s.avg_alpha >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {s.avg_alpha >= 0 ? '+' : ''}{formatPct(s.avg_alpha, 2)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ScoreBadge score={s.score} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs font-mono text-gray-300">
                          {s.current_weight != null ? formatPct(s.current_weight) : '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-white/10">
              <div className="grid grid-cols-3 gap-4 text-xs text-gray-500">
                <div>
                  <span className="font-medium text-gray-400">Brier score</span> — squared error of probability estimate.
                  0 = perfect, 0.25 = random. Lower is better.
                </div>
                <div>
                  <span className="font-medium text-gray-400">Hit rate</span> — fraction of correct direction calls.
                  &gt;55% is meaningfully good over many samples.
                </div>
                <div>
                  <span className="font-medium text-gray-400">Alpha</span> — return vs SPY for the same period.
                  Positive means the signal added value vs just holding the index.
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* How it works */}
      <Card>
        <div className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-4 w-4 text-indigo-400" />
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">How It Works</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-gray-400">
            {[
              {
                title: '1. Log decisions',
                body: 'Every call to /api/predict logs the signal, confidence, and predicted direction for each symbol and strategy.',
              },
              {
                title: '2. Grade outcomes',
                body: 'After the horizon passes (default 7 days), the loop fetches real prices and computes actual return, alpha vs SPY, and Brier score.',
              },
              {
                title: '3. Score strategies',
                body: 'Each strategy is scored on calibration (Brier × 3), direction accuracy (hit rate × 2), and alpha (× 2). Minimum 20 samples required.',
              },
              {
                title: '4. Update weights',
                body: 'Softmax converts scores to a target weight distribution. Evolution is clamped to 8% change per pass. Weights are saved to Supabase.',
              },
            ].map(({ title, body }) => (
              <div key={title} className="rounded-lg bg-white/5 p-3">
                <p className="font-semibold text-gray-300 mb-1">{title}</p>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}
