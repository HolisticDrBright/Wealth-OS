'use client'

import type { CIODecision } from '@/lib/agents/types'
import { TrendingUp, TrendingDown, Minus, Globe } from 'lucide-react'

const REGIME_CONFIG: Record<string, { color: string; bg: string; border: string; icon: typeof Globe }> = {
  'Risk-On Bull':   { color: 'text-emerald-400', bg: 'bg-emerald-500/5',  border: 'border-emerald-500/20', icon: TrendingUp   },
  'Risk-Off Bear':  { color: 'text-red-400',     bg: 'bg-red-500/5',      border: 'border-red-500/20',     icon: TrendingDown },
  'Stagflation':    { color: 'text-amber-400',   bg: 'bg-amber-500/5',    border: 'border-amber-500/20',   icon: Minus        },
  'Recovery':       { color: 'text-indigo-400',  bg: 'bg-indigo-500/5',   border: 'border-indigo-500/20',  icon: TrendingUp   },
  'Transition':     { color: 'text-gray-300',    bg: 'bg-white/5',        border: 'border-white/10',       icon: Globe        },
}

interface Props {
  decision: CIODecision
}

export function MacroRegimeBanner({ decision }: Props) {
  const macroAgent = decision.agentOutputs.find(o => o.agent === 'MacroRegimeAgent')
  if (!macroAgent) return null

  // Extract regime from key points or reasoning
  const regime = Object.keys(REGIME_CONFIG).find(r =>
    macroAgent.reasoning.includes(r) || macroAgent.keyPoints.some(p => p.includes(r))
  ) ?? 'Transition'

  const config = REGIME_CONFIG[regime] ?? REGIME_CONFIG['Transition']
  const Icon = config.icon

  return (
    <div className={`rounded-xl border ${config.border} ${config.bg} p-3 flex items-center gap-3`}>
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${config.bg}`}>
        <Icon className={`h-4 w-4 ${config.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={`text-xs font-semibold ${config.color}`}>Macro Regime: {regime}</p>
          <span className="text-xs text-gray-500">Score: {macroAgent.score}/100</span>
        </div>
        <p className="text-xs text-gray-400 mt-0.5 truncate">{macroAgent.reasoning.slice(0, 100)}</p>
      </div>
    </div>
  )
}
