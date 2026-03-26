'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, MinusCircle, Clock } from 'lucide-react'
import type { CIODecision, AgentOutput } from '@/lib/agents/types'

const RECOMMENDATION_CONFIG = {
  approve: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Approve' },
  reduce:  { icon: MinusCircle,  color: 'text-amber-400',   bg: 'bg-amber-500/10',   label: 'Reduce'  },
  defer:   { icon: Clock,        color: 'text-indigo-400',  bg: 'bg-indigo-500/10',  label: 'Defer'   },
  reject:  { icon: XCircle,      color: 'text-red-400',     bg: 'bg-red-500/10',     label: 'Reject'  },
}

function AgentRow({ output }: { output: AgentOutput }) {
  const [expanded, setExpanded] = useState(false)
  const config = RECOMMENDATION_CONFIG[output.recommendation]
  const Icon = config.icon

  return (
    <div className="rounded-lg border border-white/5 overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 p-3 hover:bg-white/5 transition-colors text-left"
      >
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${config.bg} shrink-0`}>
          <Icon className={`h-3.5 w-3.5 ${config.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white">{output.agent}</p>
          <p className="text-xs text-gray-500 truncate">{output.reasoning.slice(0, 60)}…</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs font-bold ${config.color}`}>{output.score}</span>
          <div className="h-1.5 w-16 rounded-full bg-white/10">
            <div
              className={`h-full rounded-full ${
                output.score >= 70 ? 'bg-emerald-500' :
                output.score >= 50 ? 'bg-indigo-500' :
                output.score >= 35 ? 'bg-amber-500' : 'bg-red-500'
              }`}
              style={{ width: `${output.score}%` }}
            />
          </div>
          {expanded ? <ChevronUp className="h-3 w-3 text-gray-500" /> : <ChevronDown className="h-3 w-3 text-gray-500" />}
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-0 space-y-2 bg-white/[0.02]">
          <p className="text-xs text-gray-300 leading-relaxed">{output.reasoning}</p>
          {output.keyPoints.length > 0 && (
            <ul className="space-y-1">
              {output.keyPoints.map((pt, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-gray-400">
                  <span className="text-indigo-400 shrink-0">•</span>{pt}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

interface Props {
  decision: CIODecision
  defaultExpanded?: boolean
}

export function InvestmentCommitteeView({ decision, defaultExpanded = false }: Props) {
  const [open, setOpen] = useState(defaultExpanded)

  const votes = {
    approve: decision.agentOutputs.filter(o => o.recommendation === 'approve').length,
    reduce:  decision.agentOutputs.filter(o => o.recommendation === 'reduce').length,
    defer:   decision.agentOutputs.filter(o => o.recommendation === 'defer').length,
    reject:  decision.agentOutputs.filter(o => o.recommendation === 'reject').length,
  }

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <p className="text-sm font-semibold text-white">Investment Committee</p>
          <div className="flex items-center gap-1.5 text-xs">
            {votes.approve > 0 && <span className="text-emerald-400">{votes.approve} approve</span>}
            {votes.reduce > 0  && <span className="text-amber-400">{votes.reduce} reduce</span>}
            {votes.defer > 0   && <span className="text-indigo-400">{votes.defer} defer</span>}
            {votes.reject > 0  && <span className="text-red-400">{votes.reject} reject</span>}
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2 border-t border-white/10 pt-3">
          {decision.agentOutputs.map(output => (
            <AgentRow key={output.agent} output={output} />
          ))}
        </div>
      )}
    </div>
  )
}
