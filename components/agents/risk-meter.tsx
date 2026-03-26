'use client'

import type { CIODecision } from '@/lib/agents/types'

interface Props {
  decision: CIODecision
  showLabel?: boolean
}

export function RiskMeter({ decision, showLabel = true }: Props) {
  const riskAgent = decision.agentOutputs.find(o => o.agent === 'RiskManagementAgent')
  // Risk score is inverted: high score = safe, low score = risky
  const safetyScore = riskAgent?.score ?? 50
  const riskScore = 100 - safetyScore

  const getConfig = (score: number) => {
    if (score >= 75) return { label: 'High Risk', color: '#ef4444', segments: 5 }
    if (score >= 55) return { label: 'Elevated', color: '#f59e0b', segments: 4 }
    if (score >= 35) return { label: 'Moderate', color: '#6366f1', segments: 3 }
    if (score >= 15) return { label: 'Low Risk', color: '#10b981', segments: 2 }
    return { label: 'Very Safe', color: '#10b981', segments: 1 }
  }

  const { label, color, segments } = getConfig(riskScore)
  const totalSegments = 5

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        {showLabel && <p className="text-xs font-medium text-gray-400">Portfolio Risk</p>}
        <p className="text-xs font-bold ml-auto" style={{ color }}>{label}</p>
      </div>
      <div className="flex items-center gap-1">
        {Array.from({ length: totalSegments }).map((_, i) => (
          <div
            key={i}
            className="flex-1 h-2 rounded-full transition-all"
            style={{
              backgroundColor: i < segments ? color : 'rgba(255,255,255,0.08)',
              opacity: i < segments ? 1 - (i * 0.1) : 1,
            }}
          />
        ))}
      </div>
      {riskAgent && (
        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">
          {riskAgent.reasoning.slice(0, 100)}…
        </p>
      )}
    </div>
  )
}
