'use client'

/**
 * InvestmentCommitteeModal — a reusable review modal for any opportunity, trade,
 * or paper position. Unlike CIODecisionModal (which runs a fresh 13-agent
 * analysis over the network), this one renders a *precomputed* CIODecision so it
 * can be opened instantly from cards, strategy rows, and paper-trade rows.
 *
 * Optional extras (scenarios, exitPlan, auditTrail) are shown only when the
 * caller supplies them — we never fabricate bull/base/bear text.
 */

import { Modal } from '@/components/ui/modal'
import { MiroFishScoreBadge } from './mirofish-score-badge'
import { InvestmentCommitteeView } from './investment-committee-view'
import type { CIODecision } from '@/lib/agents/types'
import { cn } from '@/lib/utils'
import {
  CheckCircle2, XCircle, MinusCircle, Clock, AlertCircle, ShieldAlert,
  TrendingUp, ScrollText, ListChecks,
} from 'lucide-react'

const DECISION_CONFIG = {
  execute: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', label: 'Execute' },
  reduce:  { icon: MinusCircle,  color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20',  label: 'Reduce Size' },
  defer:   { icon: Clock,        color: 'text-indigo-400',  bg: 'bg-indigo-500/5',   border: 'border-indigo-500/20', label: 'Defer' },
  reject:  { icon: XCircle,      color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/20',    label: 'Do Not Trade' },
} as const

export interface CommitteeScenarios {
  bull?: string
  base?: string
  bear?: string
}

export interface AuditEntry {
  label: string
  value: string
}

interface Props {
  open: boolean
  onClose: () => void
  /** Headline like "BUY AAPL" or "0DTE Strangle Hedged". */
  headline: string
  subtitle?: string
  decision: CIODecision
  scenarios?: CommitteeScenarios
  /** Plain-English exit plan, if known. */
  exitPlan?: string
  /** Kronos confluence summary, if available. */
  kronosNote?: string
  /** Key/value audit trail rows (timestamps, ids, gate results). */
  auditTrail?: AuditEntry[]
}

function Section({ title, icon: Icon, children, tone = 'neutral' }: {
  title: string
  icon: typeof TrendingUp
  children: React.ReactNode
  tone?: 'neutral' | 'amber' | 'red'
}) {
  const ring = tone === 'amber' ? 'border-amber-500/20 bg-amber-500/5'
    : tone === 'red' ? 'border-red-500/20 bg-red-500/5'
    : 'border-white/10 bg-white/5'
  const iconColor = tone === 'amber' ? 'text-amber-400' : tone === 'red' ? 'text-red-400' : 'text-gray-400'
  return (
    <div className={cn('rounded-xl border p-4', ring)}>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
        <Icon className={cn('h-3.5 w-3.5', iconColor)} /> {title}
      </p>
      {children}
    </div>
  )
}

export function InvestmentCommitteeModal({
  open, onClose, headline, subtitle, decision,
  scenarios, exitPlan, kronosNote, auditTrail,
}: Props) {
  const config = DECISION_CONFIG[decision.decision]
  const DecisionIcon = config.icon
  const hasScenarios = !!(scenarios?.bull || scenarios?.base || scenarios?.bear)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Investment Committee"
      description={subtitle ?? headline}
      className="max-w-2xl max-h-[90vh] overflow-y-auto"
    >
      <div className="space-y-4">
        {/* Decision banner + CIO summary */}
        <div className={cn('flex items-center gap-4 rounded-xl border p-4', config.border, config.bg)}>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-black/20">
            <DecisionIcon className={cn('h-6 w-6', config.color)} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <p className={cn('text-lg font-bold', config.color)}>{config.label}</p>
              <span className="text-xs text-gray-500">Score {decision.finalScore.toFixed(0)}/100 · {decision.confidence} confidence</span>
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-gray-300">{decision.plainEnglishSummary}</p>
          </div>
        </div>

        {/* Score + recommended sizing */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="mb-3 text-xs text-gray-500">Conviction Score</p>
            <MiroFishScoreBadge score={decision.miroFishScore ?? decision.finalScore} confidence={decision.confidence} size="lg" />
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Recommended Size</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xs text-gray-500">Recommend</p>
                <p className="text-base font-bold text-white tabular-nums">{decision.positionSizing.recommended_pct}%</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Max</p>
                <p className="text-base font-bold text-gray-300 tabular-nums">{decision.positionSizing.max_pct}%</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Account</p>
                <p className="text-sm font-bold capitalize text-indigo-300">{decision.accountPlacement}</p>
              </div>
            </div>
            {decision.positionSizing.rationale && (
              <p className="mt-2 text-xs leading-relaxed text-gray-500">{decision.positionSizing.rationale}</p>
            )}
          </div>
        </div>

        {/* Bull / Base / Bear */}
        {hasScenarios && (
          <Section title="Bull · Base · Bear" icon={TrendingUp}>
            <div className="space-y-2 text-xs leading-relaxed">
              {scenarios?.bull && <p><span className="font-semibold text-emerald-400">Bull. </span><span className="text-gray-300">{scenarios.bull}</span></p>}
              {scenarios?.base && <p><span className="font-semibold text-sky-400">Base. </span><span className="text-gray-300">{scenarios.base}</span></p>}
              {scenarios?.bear && <p><span className="font-semibold text-red-400">Bear. </span><span className="text-gray-300">{scenarios.bear}</span></p>}
            </div>
          </Section>
        )}

        {/* Portfolio impact */}
        {decision.portfolioImpact && (
          <Section title="Portfolio Impact" icon={TrendingUp}>
            <p className="text-xs leading-relaxed text-gray-300">{decision.portfolioImpact}</p>
          </Section>
        )}

        {/* Kronos confluence */}
        {kronosNote && (
          <Section title="Kronos Confluence" icon={ListChecks}>
            <p className="text-xs leading-relaxed text-gray-300">{kronosNote}</p>
          </Section>
        )}

        {/* Agent votes / committee */}
        <InvestmentCommitteeView decision={decision} defaultExpanded={false} />

        {/* Risk vetoes / factors */}
        {decision.riskFactors.length > 0 && (
          <Section title="Risk Objections & Vetoes" icon={ShieldAlert} tone="amber">
            <ul className="space-y-1">
              {decision.riskFactors.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />{r}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Exit plan */}
        {(exitPlan || decision.timing) && (
          <Section title="Exit Plan & Timing" icon={Clock}>
            {exitPlan && <p className="text-xs leading-relaxed text-gray-300">{exitPlan}</p>}
            {decision.timing && <p className="mt-1 text-xs leading-relaxed text-gray-500">{decision.timing}</p>}
          </Section>
        )}

        {/* Audit trail */}
        {auditTrail && auditTrail.length > 0 && (
          <Section title="Audit Trail" icon={ScrollText}>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {auditTrail.map((a, i) => (
                <div key={i} className="flex items-center justify-between gap-2 border-b border-white/5 py-1 last:border-0">
                  <dt className="text-xs text-gray-500">{a.label}</dt>
                  <dd className="truncate text-right font-mono text-[11px] text-gray-300">{a.value}</dd>
                </div>
              ))}
            </dl>
          </Section>
        )}
      </div>
    </Modal>
  )
}
