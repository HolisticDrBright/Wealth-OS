'use client'

import type { CIODecision } from '@/lib/agents/types'
import { MiroFishScoreBadge } from './mirofish-score-badge'
import { Brain, TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface Props {
  decision: CIODecision
}

export function SimulationStatusCard({ decision }: Props) {
  const miroFish = decision.agentOutputs.find(o => o.agent === 'MiroFishSimulationAgent')
  const score = decision.miroFishScore ?? miroFish?.score ?? 50
  const meta = miroFish?.metadata as {
    bullProbability?: number
    bearProbability?: number
    consensusDirection?: string
    tailRiskScore?: number
  } | undefined

  const confidence = miroFish?.confidence ?? 'medium'

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2 mb-4">
        <Brain className="h-4 w-4 text-indigo-400" />
        <p className="text-sm font-semibold text-white">MiroFish Simulation</p>
        <span className="text-xs text-gray-500">Agent 13 — Swarm Intelligence</span>
      </div>

      <div className="flex items-center gap-6">
        <MiroFishScoreBadge score={score} confidence={confidence} size="lg" />

        <div className="flex-1 space-y-3">
          {meta && (
            <>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                    Bull probability
                  </div>
                  <span className="text-xs font-semibold text-emerald-400">
                    {((meta.bullProbability ?? 0.5) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${(meta.bullProbability ?? 0.5) * 100}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <TrendingDown className="h-3.5 w-3.5 text-red-400" />
                    Bear probability
                  </div>
                  <span className="text-xs font-semibold text-red-400">
                    {((meta.bearProbability ?? 0.5) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-red-500 transition-all"
                    style={{ width: `${(meta.bearProbability ?? 0.5) * 100}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Minus className="h-3.5 w-3.5 text-amber-400" />
                    Tail risk score
                  </div>
                  <span className="text-xs font-semibold text-amber-400">
                    {meta.tailRiskScore ?? 50}/100
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-amber-500 transition-all"
                    style={{ width: `${meta.tailRiskScore ?? 50}%` }}
                  />
                </div>
              </div>
            </>
          )}
          {miroFish?.keyPoints && miroFish.keyPoints.length > 0 && (
            <div className="mt-2 space-y-1">
              {miroFish.keyPoints.slice(0, 3).map((pt, i) => (
                <p key={i} className="text-xs text-gray-400 flex items-start gap-1.5">
                  <span className="text-indigo-400 shrink-0">•</span>{pt}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
