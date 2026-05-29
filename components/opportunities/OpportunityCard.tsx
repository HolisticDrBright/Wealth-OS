'use client'

/**
 * OpportunityCard — the canonical, information-dense opportunity tile used on the
 * Command Center and Opportunities views. Every field is optional so the card
 * degrades gracefully; missing data simply isn't shown.
 *
 * Action gating (per product rules): "Execute" is NEVER the primary action
 * unless the opportunity is explicitly live-eligible. Paper-only items show
 * "Paper Trade"; everything else shows "Review".
 */

import { cn } from '@/lib/utils'
import { MaturityBadge } from '@/components/strategies/MaturityBadge'
import { edgeTypeLabel, assetClassLabel, type Tone, TONE_CLASSES } from '@/lib/strategies/strategy-display'
import {
  LiquidityBadge, CorrelationBadge, TaxBadge, type RiskLevel,
} from '@/components/risk/RiskBadges'
import type { StrategyMaturityStatus, EdgeType, AssetClass } from '@/lib/strategies/strategy-registry'
import { type OppTradeability } from '@/lib/opportunities/tradeability'
import {
  TrendingUp, TrendingDown, Eye, FlaskConical, ArrowRight, Users, AlertTriangle,
} from 'lucide-react'

export type { OppTradeability }

export interface OppCardData {
  id: string
  /** e.g. "BUY", "SELL", "YES", "Short". */
  action?: string
  direction?: 'long' | 'short' | 'neutral'
  symbol?: string
  title: string
  assetClass?: AssetClass | string
  strategyLabel?: string
  edgeType?: EdgeType | string
  maturity?: StrategyMaturityStatus | string
  /** Plain-English "why now". */
  whyNow?: string
  /** Expected edge as a percent number, e.g. 4.2 for +4.2%. */
  expectedEdgePct?: number | null
  /** Recommended size as percent of capital. */
  recommendedSizePct?: number | null
  /** Estimated max loss in USD or percent string, pre-formatted. */
  maxLoss?: string | null
  /** One-line portfolio impact. */
  portfolioImpact?: string | null
  liquidity?: { level: RiskLevel; value: string } | null
  correlation?: { level: RiskLevel; value: string } | null
  tax?: { level: RiskLevel; value: string } | null
  exitPlan?: string | null
  /** Short agent-agreement summary, e.g. "4 approve · 1 reduce". */
  agentSummary?: string | null
  tradeability: OppTradeability
}

const TRADEABILITY_META: Record<OppTradeability, { label: string; tone: Tone }> = {
  live_eligible: { label: 'Live eligible', tone: 'positive' },
  paper_only:    { label: 'Paper only',    tone: 'accent' },
  blocked:       { label: 'Blocked',       tone: 'danger' },
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-gray-600">{label}</p>
      <p className="truncate text-xs font-medium text-gray-200">{children}</p>
    </div>
  )
}

interface Props {
  opp: OppCardData
  onReview?: (id: string) => void
  onPaperTrade?: (id: string) => void
  className?: string
}

export function OpportunityCard({ opp, onReview, onPaperTrade, className }: Props) {
  const trade = TRADEABILITY_META[opp.tradeability]
  const tradeTone = TONE_CLASSES[trade.tone]
  const isShort = opp.direction === 'short' || opp.action?.toLowerCase() === 'sell'
  const DirIcon = isShort ? TrendingDown : TrendingUp
  const edgePositive = (opp.expectedEdgePct ?? 0) >= 0

  return (
    <div className={cn('rounded-xl border border-white/10 bg-white/5 p-4 transition-colors hover:border-white/20', className)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', isShort ? 'bg-red-500/10' : 'bg-emerald-500/10')}>
            <DirIcon className={cn('h-4 w-4', isShort ? 'text-red-400' : 'text-emerald-400')} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {opp.action && <span className="text-xs font-bold uppercase text-gray-200">{opp.action}</span>}
              {opp.symbol && <span className="font-mono text-sm font-bold text-indigo-300">{opp.symbol}</span>}
            </div>
            <p className="mt-0.5 truncate text-sm font-medium text-white">{opp.title}</p>
          </div>
        </div>
        <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium', tradeTone.text, tradeTone.bg, tradeTone.border)}>
          {trade.label}
        </span>
      </div>

      {/* Tag row */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {opp.maturity && <MaturityBadge status={opp.maturity} />}
        {opp.assetClass && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-gray-400">{assetClassLabel(opp.assetClass)}</span>}
        {opp.edgeType && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-gray-400">{edgeTypeLabel(opp.edgeType)} edge</span>}
        {opp.strategyLabel && <span className="truncate rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-gray-400">{opp.strategyLabel}</span>}
      </div>

      {/* Why now */}
      {opp.whyNow && <p className="mt-2 text-xs leading-relaxed text-gray-400"><span className="font-semibold text-gray-300">Why now: </span>{opp.whyNow}</p>}

      {/* Metric grid */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {opp.expectedEdgePct != null && (
          <Field label="Expected edge">
            <span className={edgePositive ? 'text-emerald-400' : 'text-red-400'}>
              {edgePositive ? '+' : ''}{opp.expectedEdgePct.toFixed(1)}%
            </span>
          </Field>
        )}
        {opp.recommendedSizePct != null && <Field label="Rec. size">{opp.recommendedSizePct.toFixed(1)}%</Field>}
        {opp.maxLoss && <Field label="Max loss"><span className="text-red-300">{opp.maxLoss}</span></Field>}
        {opp.portfolioImpact && <Field label="Portfolio">{opp.portfolioImpact}</Field>}
      </div>

      {/* Risk badge row */}
      {(opp.liquidity || opp.correlation || opp.tax) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {opp.liquidity && <LiquidityBadge level={opp.liquidity.level} value={opp.liquidity.value} />}
          {opp.correlation && <CorrelationBadge level={opp.correlation.level} value={opp.correlation.value} />}
          {opp.tax && <TaxBadge level={opp.tax.level} value={opp.tax.value} />}
        </div>
      )}

      {/* Correlation warning callout */}
      {opp.correlation?.level === 'risk' && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <p className="text-[11px] text-amber-200">High overlap with your existing positions — sizing should be reduced.</p>
        </div>
      )}

      {/* Exit plan */}
      {opp.exitPlan && <p className="mt-2 text-[11px] text-gray-500"><span className="font-semibold text-gray-400">Exit: </span>{opp.exitPlan}</p>}

      {/* Footer: agents + actions */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/5 pt-3">
        {opp.agentSummary ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
            <Users className="h-3 w-3" /> {opp.agentSummary}
          </span>
        ) : <span />}
        <div className="flex items-center gap-2">
          {onReview && (
            <button
              onClick={() => onReview(opp.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10"
            >
              <Eye className="h-3.5 w-3.5" /> Review
            </button>
          )}
          {opp.tradeability === 'paper_only' && onPaperTrade && (
            <button
              onClick={() => onPaperTrade(opp.id)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
            >
              <FlaskConical className="h-3.5 w-3.5" /> Paper Trade
            </button>
          )}
          {opp.tradeability === 'live_eligible' && onReview && (
            <button
              onClick={() => onReview(opp.id)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
            >
              Review for live <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
