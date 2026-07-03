'use client'

/**
 * Agent Reasoning Transparency Panel (widget 2) — per decision, the verdicts
 * of the committee stages that actually ran (Red Team, MiroFish, Kronos,
 * risk/cost/kill-switch gates), with the block reason expandable. Every trade
 * links back to a decision here — this IS the audit trail surface.
 */

import { useState } from 'react'
import { Brain } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Panel } from './Panel'
import { EmptyState } from '@/components/ui/states'
import type { DecisionReasoningRow } from '@/lib/actions/decision-reasoning'

function relTime(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`
}

function VerdictChip({ label, value, tone }: { label: string; value: string; tone: 'good' | 'bad' | 'neutral' | 'off' }) {
  return (
    <span className={cn(
      'rounded px-1.5 py-0.5 text-[10px] font-medium',
      tone === 'good' ? 'bg-emerald-500/15 text-emerald-400'
      : tone === 'bad' ? 'bg-red-500/15 text-red-400'
      : tone === 'off' ? 'bg-white/5 text-gray-600'
      : 'bg-white/10 text-gray-400',
    )}>
      {label} {value}
    </span>
  )
}

export function AgentReasoningPanel({ decisions }: { decisions: DecisionReasoningRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <Panel icon={Brain} title="Agent Reasoning" right={
      <span className="text-[10px] text-gray-600">every decision, auditable</span>
    }>
      {decisions.length === 0 ? (
        <EmptyState icon={Brain} title="No decisions yet" hint="Committee verdicts appear here per decision — the audit trail." />
      ) : (
        <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
          {decisions.map(d => (
            <div key={d.id} className="rounded-lg border border-white/5 bg-white/[0.015]">
              <button
                onClick={() => setExpanded(e => (e === d.id ? null : d.id))}
                className="flex w-full flex-wrap items-center gap-2 px-2.5 py-1.5 text-left text-[11px] hover:bg-white/[0.03]"
              >
                <span className="w-8 shrink-0 font-mono text-gray-600">{relTime(d.at)}</span>
                <span className={cn(
                  'w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-bold uppercase',
                  d.decision === 'execute' ? 'bg-emerald-500/15 text-emerald-400'
                  : d.decision === 'block' ? 'bg-red-500/15 text-red-400'
                  : 'bg-amber-500/15 text-amber-400',
                )}>
                  {d.decision === 'reduce_size' ? 'reduce' : d.decision}
                </span>
                <span className="w-28 shrink-0 truncate text-gray-200">{d.symbol}</span>
                <span className="w-36 shrink-0 truncate text-gray-500">{d.strategyKey}</span>
                <span className="flex flex-wrap gap-1">
                  <VerdictChip label="RT" value={d.redTeamScore != null ? d.redTeamScore.toFixed(0) : '—'}
                    tone={d.redTeamScore == null ? 'off' : d.redTeamScore >= 30 ? 'good' : 'bad'} />
                  <VerdictChip label="MF" value={d.miroFishUsed && d.miroFishScore != null ? d.miroFishScore.toFixed(0) : 'skip'}
                    tone={!d.miroFishUsed ? 'off' : (d.miroFishScore ?? 0) >= 50 ? 'good' : 'bad'} />
                  <VerdictChip label="KR" value={d.kronosUsed ? (d.kronosPass ? 'pass' : 'veto') : 'skip'}
                    tone={!d.kronosUsed ? 'off' : d.kronosPass ? 'good' : 'bad'} />
                  {d.blockedBy && <VerdictChip label="GATE" value={d.blockedBy} tone="bad" />}
                </span>
                {d.sizeFraction != null && d.sizeFraction > 0 && (
                  <span className="ml-auto font-mono text-gray-500">{(d.sizeFraction * 100).toFixed(1)}%</span>
                )}
              </button>
              {expanded === d.id && (
                <div className="border-t border-white/5 px-2.5 py-2 text-[11px] leading-relaxed text-gray-400">
                  {d.reason ?? 'No recorded reason — decision passed all gates.'}
                  {d.direction && <span className="ml-2 text-gray-600">direction: {d.direction}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
