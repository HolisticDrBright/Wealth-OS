'use client'

/**
 * Agent Trust / Calibration board.
 *
 * Shows, per AI layer, how much it is currently trusted and whether its vote
 * actually affects real decisions. Per-agent accuracy/Brier are frequently null
 * (dev tables empty, per-agent attribution not persisted) — we render those
 * cells honestly with InsufficientData rather than inventing numbers.
 */

import { Brain, Crosshair, Shield, Gauge, Check, Minus } from 'lucide-react'
import { CalibrationBadge, brierToLevel } from '@/components/risk/RiskBadges'
import { InsufficientData } from '@/components/ui/states'
import { formatPercentage, cn } from '@/lib/utils'
import type { AgentTrust } from '@/lib/actions/agent-trust'

const AGENT_ICON: Record<string, typeof Brain> = {
  mirofish: Brain,
  kronos: Gauge,
  red_team: Shield,
  cio: Crosshair,
}

function StatusBadge({ status }: { status: AgentTrust['status'] }) {
  const map = {
    active: { label: 'Active', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
    shadow: { label: 'Shadow', cls: 'text-sky-400 bg-sky-500/10 border-sky-500/20' },
    disabled: { label: 'Disabled', cls: 'text-gray-400 bg-white/5 border-white/10' },
  } as const
  const { label, cls } = map[status]
  const title =
    status === 'shadow'
      ? 'Shadow: computes but does not drive execution'
      : status === 'disabled'
        ? 'Disabled: not running'
        : 'Active: contributes to the executed decision'
  return (
    <span
      title={title}
      className={cn('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none', cls)}
    >
      {label}
    </span>
  )
}

function AffectsCell({ agent }: { agent: AgentTrust }) {
  if (agent.affectsDecisions) {
    return (
      <span title="Vote contributes to the executed decision" className="inline-flex items-center text-emerald-400">
        <Check className="h-4 w-4" />
      </span>
    )
  }
  return (
    <span
      title="Shadow agents compute but do not drive execution"
      className="inline-flex items-center text-gray-600"
    >
      <Minus className="h-4 w-4" />
    </span>
  )
}

function VoteWeightCell({ value }: { value: number | null }) {
  if (value == null) return <InsufficientData label="n/a" />
  return <span className="font-mono text-sm text-gray-300">{formatPercentage(value * 100)}</span>
}

function AccuracyCell({ value }: { value: number | null }) {
  if (value == null) return <InsufficientData />
  const cls = value >= 0.55 ? 'text-emerald-400' : value >= 0.45 ? 'text-gray-300' : 'text-red-400'
  return <span className={cn('font-mono text-sm', cls)}>{(value * 100).toFixed(1)}%</span>
}

function BrierCell({ value }: { value: number | null }) {
  if (value == null) return <InsufficientData />
  const { level, value: label } = brierToLevel(value)
  return <CalibrationBadge level={level} value={label} />
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function AgentTrustBoard({ agents }: { agents: AgentTrust[] }) {
  const allMetricsNull = agents.every(
    a => a.voteWeight == null && a.accuracy == null && a.brier == null && (a.gradedCount == null || a.gradedCount === 0),
  )

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <Crosshair className="h-4 w-4 text-indigo-400 shrink-0" />
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Agent Trust</h2>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          How much each AI layer is currently trusted, and whether its vote affects real decisions.
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5">
        {/* Desktop / tablet: table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs text-gray-500">
                <th className="text-left px-4 py-3 font-medium">Agent</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-center px-4 py-3 font-medium">Affects decisions</th>
                <th className="text-right px-4 py-3 font-medium">Vote weight</th>
                <th className="text-right px-4 py-3 font-medium">Recent accuracy</th>
                <th className="text-right px-4 py-3 font-medium">Brier</th>
                <th className="text-right px-4 py-3 font-medium">Graded n</th>
                <th className="text-right px-4 py-3 font-medium">Last recalibrated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {agents.map(a => {
                const Icon = AGENT_ICON[a.key] ?? Brain
                return (
                  <tr key={a.key} className="hover:bg-white/5 transition-colors align-top">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-indigo-400 shrink-0" />
                        <span
                          className="font-medium text-white cursor-help"
                          title={a.description ?? a.name}
                        >
                          {a.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3" title={a.note}>
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <AffectsCell agent={a} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <VoteWeightCell value={a.voteWeight} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <AccuracyCell value={a.accuracy} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end">
                        <BrierCell value={a.brier} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 tabular-nums">
                      {a.gradedCount != null ? a.gradedCount.toLocaleString() : '0'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 text-xs whitespace-nowrap">
                      {fmtDate(a.lastRecalibrated)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile: stacked cards */}
        <div className="md:hidden divide-y divide-white/5">
          {agents.map(a => {
            const Icon = AGENT_ICON[a.key] ?? Brain
            return (
              <div key={a.key} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="h-4 w-4 text-indigo-400 shrink-0" />
                    <span className="font-medium text-white truncate">{a.name}</span>
                  </div>
                  <div title={a.note}>
                    <StatusBadge status={a.status} />
                  </div>
                </div>
                {a.description && <p className="text-xs text-gray-500">{a.description}</p>}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-gray-500">Affects</span>
                    <AffectsCell agent={a} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-gray-500">Weight</span>
                    <VoteWeightCell value={a.voteWeight} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-gray-500">Accuracy</span>
                    <AccuracyCell value={a.accuracy} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-gray-500">Brier</span>
                    <BrierCell value={a.brier} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-gray-500">Graded n</span>
                    <span className="text-gray-400 tabular-nums">
                      {a.gradedCount != null ? a.gradedCount.toLocaleString() : '0'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-gray-500">Recalibrated</span>
                    <span className="text-gray-400">{fmtDate(a.lastRecalibrated)}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {allMetricsNull && (
          <div className="px-4 py-3 border-t border-white/10">
            <p className="text-xs text-gray-500">
              Accuracy and Brier scores populate once predictions are graded against outcomes.
              Status, vote weight, and whether a vote affects decisions are meaningful now.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
