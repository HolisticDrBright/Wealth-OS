'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { MiroFishScoreBadge } from './mirofish-score-badge'
import { AgentRadar, agentsFromDecision } from './agent-radar'
import { InvestmentCommitteeView } from './investment-committee-view'
import { SimulationStatusCard } from './simulation-status-card'
import { MacroRegimeBanner } from './macro-regime-banner'
import { RiskMeter } from './risk-meter'
import { Button } from '@/components/ui/button'
import type { CIODecision, TradeContext } from '@/lib/agents/types'
import { Brain, RefreshCw, CheckCircle2, XCircle, MinusCircle, Clock, TrendingUp, AlertCircle } from 'lucide-react'

const DECISION_CONFIG = {
  execute: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', label: 'Execute Trade' },
  reduce:  { icon: MinusCircle,  color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20',  label: 'Reduce Size'  },
  defer:   { icon: Clock,        color: 'text-indigo-400',  bg: 'bg-indigo-500/5',   border: 'border-indigo-500/20', label: 'Defer'        },
  reject:  { icon: XCircle,      color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/20',    label: 'Rejected'     },
}

interface Props {
  open: boolean
  onClose: () => void
  tradeContext: Omit<TradeContext, 'user'> & { user: Partial<TradeContext['user']> & { id: string } }
}

export function CIODecisionModal({ open, onClose, tradeContext }: Props) {
  const [loading, setLoading] = useState(false)
  const [decision, setDecision] = useState<CIODecision | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runAnalysis() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/analyze-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tradeContext),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Analysis failed')
      setDecision(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  // Auto-run on open
  if (open && !decision && !loading && !error) {
    runAnalysis()
  }

  const config = decision ? DECISION_CONFIG[decision.decision] : null
  const DecisionIcon = config?.icon

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Investment Committee Analysis"
      description={`${tradeContext.trade.action.toUpperCase()} ${tradeContext.trade.symbol} — CIO Decision`}
      className="max-w-2xl max-h-[90vh] overflow-y-auto"
    >
      {loading && (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <Brain className="h-10 w-10 text-indigo-400 animate-pulse" />
          <div className="text-center">
            <p className="text-sm font-semibold text-white">Running 13-Agent Analysis</p>
            <p className="text-xs text-gray-500 mt-1">
              Orchestrator → Domain Experts → Risk Management → MiroFish Simulation…
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <RefreshCw className="h-3 w-3 animate-spin" />
            This takes 30–60 seconds
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-400">Analysis failed</p>
              <p className="text-xs text-gray-400 mt-1">{error}</p>
              {error.includes('API_KEY') && (
                <p className="text-xs text-gray-500 mt-2">
                  Add your <code className="bg-white/10 px-1 rounded">ANTHROPIC_API_KEY</code> to .env.local and Vercel.
                </p>
              )}
            </div>
          </div>
          <Button size="sm" onClick={runAnalysis} className="mt-3">Retry</Button>
        </div>
      )}

      {decision && config && DecisionIcon && (
        <div className="space-y-4">
          {/* Decision Banner */}
          <div className={`rounded-xl border ${config.border} ${config.bg} p-4 flex items-center gap-4`}>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-black/20">
              <DecisionIcon className={`h-6 w-6 ${config.color}`} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <p className={`text-lg font-bold ${config.color}`}>{config.label}</p>
                <span className="text-xs text-gray-500">Score: {decision.finalScore.toFixed(1)}/100</span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{decision.plainEnglishSummary}</p>
            </div>
          </div>

          {/* Score + Radar */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col items-center justify-center rounded-xl bg-white/5 border border-white/10 p-4">
              <p className="text-xs text-gray-500 mb-3">MiroFish Score</p>
              <MiroFishScoreBadge
                score={decision.miroFishScore ?? decision.finalScore}
                confidence={decision.confidence}
                size="lg"
              />
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-2">
              <p className="text-xs text-gray-500 text-center mb-1">Opportunity Radar</p>
              <AgentRadar agents={agentsFromDecision(decision)} size={200} />
            </div>
          </div>

          {/* Position Sizing */}
          {decision.decision !== 'reject' && (
            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Position Sizing</p>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xs text-gray-500">Recommended</p>
                  <p className="text-lg font-bold text-white">{decision.positionSizing.recommended_pct}%</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Max allowed</p>
                  <p className="text-lg font-bold text-gray-300">{decision.positionSizing.max_pct}%</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Account</p>
                  <p className="text-sm font-bold text-indigo-300 capitalize">{decision.accountPlacement}</p>
                </div>
              </div>
              {decision.positionSizing.rationale && (
                <p className="text-xs text-gray-500 mt-2 leading-relaxed">{decision.positionSizing.rationale}</p>
              )}
            </div>
          )}

          {/* Macro + Risk */}
          <MacroRegimeBanner decision={decision} />
          <div className="rounded-xl bg-white/5 border border-white/10 p-4">
            <RiskMeter decision={decision} />
          </div>

          {/* MiroFish simulation */}
          <SimulationStatusCard decision={decision} />

          {/* Investment Committee */}
          <InvestmentCommitteeView decision={decision} defaultExpanded={false} />

          {/* Risk Factors */}
          {decision.riskFactors.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">Risk Factors</p>
              <ul className="space-y-1">
                {decision.riskFactors.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button size="sm" variant="outline" onClick={runAnalysis} disabled={loading}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Re-analyze
            </Button>
            <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
