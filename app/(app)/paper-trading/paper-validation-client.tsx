'use client'

/**
 * Paper Trading Validation dashboard — dense operator console. Pure
 * presentation over PaperValidationData; no fetching here.
 *
 * Everything shown is MODELED paper data (deterministic fill model), never
 * live fills — the disclaimer is rendered, not implied.
 */

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/states'
import { Panel } from '@/app/(app)/dashboard/command-center/Panel'
import {
  ShieldCheck, Activity, Layers, ListChecks, Table2, GitBranch,
  AlertTriangle, FlaskConical, BookOpenCheck, Radar,
} from 'lucide-react'
import type { PaperValidationData } from '@/lib/actions/paper-validation'
import type { PaperScorecard } from '@/lib/paper-trading/scorecard-core'
import type { ChecklistItem } from '@/lib/paper-trading/runbook-checklist'

// ─── helpers ──────────────────────────────────────────────────────────────────

function relTime(iso: string | null): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (!isFinite(then)) return '—'
  const m = Math.round((Date.now() - then) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

const usd = (v: number) => `$${Math.round(v).toLocaleString()}`
const pct = (v: number | null, digits = 2) => v == null ? '—' : `${v.toFixed(digits)}%`

function Num({ v, digits = 2, signed = false }: { v: number | null; digits?: number; signed?: boolean }) {
  if (v == null) return <span className="text-gray-600">—</span>
  const cls = !signed ? 'text-gray-200' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-gray-400'
  return <span className={cn('tabular-nums', cls)}>{signed && v > 0 ? '+' : ''}{v.toFixed(digits)}</span>
}

const STATUS_BADGE: Record<PaperScorecard['validationStatus'], { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'info' }> = {
  promotion_ready: { label: 'gates pass', variant: 'success' },
  review_ready: { label: 'review ready', variant: 'info' },
  collecting: { label: 'collecting', variant: 'default' },
  open_only: { label: 'open only', variant: 'default' },
  blocked_only: { label: 'blocked only', variant: 'warning' },
  missing_data: { label: 'missing data', variant: 'warning' },
  no_activity: { label: 'no activity', variant: 'default' },
}

// ─── safety strip ─────────────────────────────────────────────────────────────

function SafetyStrip({ data }: { data: PaperValidationData }) {
  const s = data.safety
  const cells: Array<{ label: string; value: string; tone: 'ok' | 'bad' | 'muted' }> = [
    {
      label: 'Master switch',
      value: s.liveTradingEnabled ? 'ON — VIOLATION' : s.masterSwitchEnvSet ? 'set but not "true"' : 'unset (off)',
      tone: s.liveTradingEnabled ? 'bad' : 'ok',
    },
    {
      label: 'liveReady brokers',
      value: `${s.liveReadyCount} / ${s.brokers.length}`,
      tone: s.liveReadyCount > 0 ? 'bad' : 'ok',
    },
    {
      label: 'live_candidate strategies',
      value: s.liveCandidateStrategies.length === 0 ? 'none' : s.liveCandidateStrategies.join(', '),
      tone: s.liveCandidateStrategies.length > 0 ? 'bad' : 'ok',
    },
    {
      label: 'Configured brokers',
      value: String(s.brokers.filter(b => b.configured).length),
      tone: 'muted',
    },
    {
      label: 'Silent workers',
      value: data.deadWorkers == null ? 'not checked' : String(data.deadWorkers),
      tone: data.deadWorkers != null && data.deadWorkers > 0 ? 'bad' : 'muted',
    },
  ]
  return (
    <Panel icon={ShieldCheck} title="Safety gates" right={
      <span className="text-[11px] text-gray-600">every broker submission requires guard token + master switch + liveReady</span>
    }>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {cells.map(c => (
          <div key={c.label} className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className={cn('text-sm font-semibold',
              c.tone === 'ok' ? 'text-emerald-400' : c.tone === 'bad' ? 'text-red-400' : 'text-gray-200')}>
              {c.value}
            </p>
            <p className="mt-0.5 text-[10px] text-gray-600">{c.label}</p>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ─── scorecards table ─────────────────────────────────────────────────────────

function ScorecardsPanel({ cards }: { cards: PaperScorecard[] }) {
  if (cards.length === 0) {
    return (
      <Panel icon={Table2} title="Strategy scorecards">
        <EmptyState icon={Table2} title="No scorecards yet"
          hint="Enable strategies for paper trading and let the scheduled scans run." />
      </Panel>
    )
  }
  return (
    <Panel icon={Table2} title={`Strategy scorecards (${cards.length})`} right={
      <span className="text-[11px] text-amber-400/80">modeled fills — not live results</span>
    }>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-gray-600">
              <th className="py-1.5 pr-2">Strategy</th>
              <th className="px-2">Status</th>
              <th className="px-2 text-right">Closed</th>
              <th className="px-2 text-right">Open</th>
              <th className="px-2 text-right">Win %</th>
              <th className="px-2 text-right">Expect %</th>
              <th className="px-2 text-right">Gross %</th>
              <th className="px-2 text-right">Max DD</th>
              <th className="px-2 text-right">Streak</th>
              <th className="px-2 text-right">Blocked</th>
              <th className="px-2 text-right">Veto</th>
              <th className="px-2 text-right">Slip e/x</th>
              <th className="px-2 text-right">Last trade</th>
            </tr>
          </thead>
          <tbody>
            {cards.map(c => (
              <tr key={c.strategyKey} className="border-b border-white/5" title={c.maturityRecommendation}>
                <td className="py-1.5 pr-2">
                  <span className="font-medium text-gray-200">{c.strategyKey}</span>
                  <span className="ml-1.5 text-[10px] text-gray-600">{c.assetClass}</span>
                  {c.materialCostImpact && (
                    <span className="ml-1.5 text-[10px] text-amber-400" title="Modeled slippage materially changes expectancy — the edge may not survive real costs">⚠ cost</span>
                  )}
                </td>
                <td className="px-2">
                  <Badge variant={STATUS_BADGE[c.validationStatus].variant}>
                    {STATUS_BADGE[c.validationStatus].label}
                  </Badge>
                </td>
                <td className="px-2 text-right tabular-nums text-gray-300">{c.closedTrades}</td>
                <td className="px-2 text-right tabular-nums text-gray-400">{c.openPositions}</td>
                <td className="px-2 text-right"><Num v={c.winRatePct} digits={0} /></td>
                <td className="px-2 text-right"><Num v={c.expectancyPct} signed /></td>
                <td className="px-2 text-right"><Num v={c.grossExpectancyPct} signed /></td>
                <td className="px-2 text-right"><Num v={c.maxDrawdownPct} digits={1} /></td>
                <td className="px-2 text-right tabular-nums text-gray-400">{c.longestLossStreak || '—'}</td>
                <td className="px-2 text-right tabular-nums text-gray-400">{c.blockedCount || '—'}</td>
                <td className="px-2 text-right tabular-nums text-gray-400">{c.riskVetoCount || '—'}</td>
                <td className="px-2 text-right tabular-nums text-gray-500">
                  {c.entrySlippageBps != null || c.exitSlippageBps != null
                    ? `${c.entrySlippageBps ?? '—'}/${c.exitSlippageBps ?? '—'}`
                    : '—'}
                </td>
                <td className="px-2 text-right text-gray-500">{relTime(c.lastTradeAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-gray-600">
        Expect % is net of the modeled spread+impact; Gross % reconstructs pre-cost expectancy from recorded modeled slippage.
        Hover a row for the threshold-derived maturity recommendation. Promotion needs ≥30 closed, positive net expectancy,
        Brier &lt; 0.22, DD ≤ 15%, and a clean shadow check.
      </p>
    </Panel>
  )
}

// ─── coverage ─────────────────────────────────────────────────────────────────

function CoveragePanel({ data }: { data: PaperValidationData }) {
  const c = data.coverage
  const buckets: Array<{ label: string; entries: typeof c.trading; tone?: 'warn' }> = [
    { label: `Trading (${c.trading.length})`, entries: c.trading },
    { label: `Review-ready (${c.reviewReady.length})`, entries: c.reviewReady },
    { label: `Never traded (${c.neverTraded.length})`, entries: c.neverTraded, tone: 'warn' },
    { label: `Blocked by risk/cost (${c.blockedByRisk.length})`, entries: c.blockedByRisk, tone: 'warn' },
    { label: `Missing data (${c.blockedByMissingData.length})`, entries: c.blockedByMissingData, tone: 'warn' },
    { label: `Silent (${c.silent.length})`, entries: c.silent, tone: 'warn' },
  ]
  return (
    <Panel icon={Radar} title={`Strategy coverage — ${c.enabledCount} paper-enabled / ${c.totalCount} tracked`}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {buckets.map(b => (
          <div key={b.label} className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
            <p className={cn('mb-1.5 text-[10px] font-semibold uppercase tracking-wider',
              b.tone === 'warn' && b.entries.length > 0 ? 'text-amber-400' : 'text-gray-500')}>
              {b.label}
            </p>
            {b.entries.length === 0 ? (
              <p className="text-[11px] text-gray-600">none</p>
            ) : (
              <ul className="space-y-1">
                {b.entries.slice(0, 8).map(e => (
                  <li key={e.strategyKey} className="text-[11px] text-gray-300" title={e.detail}>
                    {e.strategyKey}
                    <span className="ml-1 text-gray-600">{e.detail.length > 46 ? `${e.detail.slice(0, 46)}…` : e.detail}</span>
                  </li>
                ))}
                {b.entries.length > 8 && <li className="text-[10px] text-gray-600">+{b.entries.length - 8} more</li>}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ─── positions ────────────────────────────────────────────────────────────────

function PositionsPanel({ data }: { data: PaperValidationData }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Panel icon={Activity} title={`Open paper positions (${data.openPositions.length})`}>
        {data.openPositions.length === 0 ? (
          <EmptyState icon={Activity} title="No open positions" hint="Fills appear here after the next paper run." />
        ) : (
          <ul className="divide-y divide-white/5">
            {data.openPositions.slice(0, 12).map((p, i) => (
              <li key={i} className="flex items-center justify-between py-1.5 text-[11px]">
                <span className="min-w-0 truncate">
                  <span className="font-medium text-gray-200">{p.symbol}</span>
                  <span className={cn('ml-1.5', p.direction === 'long' ? 'text-emerald-400' : p.direction === 'short' ? 'text-red-400' : 'text-gray-400')}>{p.direction}</span>
                  <span className="ml-1.5 text-gray-600">{p.strategyKey}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3 tabular-nums">
                  <span className="text-gray-400">{usd(p.notionalUsd)}</span>
                  <Num v={p.unrealizedPnlUsd} signed />
                  <span className="text-gray-600">{relTime(p.openedAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel icon={Layers} title={`Recently closed (${data.recentClosed.length})`}>
        {data.recentClosed.length === 0 ? (
          <EmptyState icon={Layers} title="Nothing closed yet" hint="Closed positions with realized modeled P&L appear here." />
        ) : (
          <ul className="divide-y divide-white/5">
            {data.recentClosed.slice(0, 12).map((p, i) => (
              <li key={i} className="flex items-center justify-between py-1.5 text-[11px]">
                <span className="min-w-0 truncate">
                  <span className="font-medium text-gray-200">{p.symbol}</span>
                  <span className="ml-1.5 text-gray-600">{p.strategyKey}</span>
                  {p.exitReason && <span className="ml-1.5 text-gray-600">({p.exitReason})</span>}
                </span>
                <span className="flex shrink-0 items-center gap-3 tabular-nums">
                  <Num v={p.realizedPnlUsd} signed />
                  <span className="text-gray-600">{relTime(p.closedAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

// ─── synergy ──────────────────────────────────────────────────────────────────

function ExposureBars({ title, slices }: { title: string; slices: PaperValidationData['synergy']['byAssetClass'] }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{title}</p>
      {slices.length === 0 ? (
        <p className="text-[11px] text-gray-600">no open exposure</p>
      ) : (
        <ul className="space-y-1.5">
          {slices.slice(0, 6).map(s => (
            <li key={s.key} className="text-[11px]">
              <div className="mb-0.5 flex justify-between">
                <span className="text-gray-300">{s.key}</span>
                <span className="tabular-nums text-gray-500">{usd(s.notionalUsd)} · {(s.fraction * 100).toFixed(0)}%</span>
              </div>
              <div className="h-1 rounded bg-white/5">
                <div className="h-1 rounded bg-sky-500/60" style={{ width: `${Math.min(100, s.fraction * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SynergyPanel({ data }: { data: PaperValidationData }) {
  const s = data.synergy
  return (
    <Panel icon={GitBranch} title={`Portfolio synergy — ${usd(s.totalOpenNotionalUsd)} open`} right={
      s.regimeNote ? <span className="max-w-md truncate text-[11px] text-gray-500" title={s.regimeNote}>{s.regimeNote}</span> : undefined
    }>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ExposureBars title="Exposure by asset class" slices={s.byAssetClass} />
        <ExposureBars title="Exposure by strategy family" slices={s.byFamily} />
      </div>
      {s.warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {s.warnings.map((w, i) => (
            <li key={i} className={cn('flex items-start gap-1.5 text-[11px]',
              w.severity === 'warning' ? 'text-amber-400' : 'text-gray-400')}>
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {w.message}
            </li>
          ))}
        </ul>
      )}
      {s.drawdownOverlap.length > 0 && (
        <p className="mt-2 text-[10px] text-gray-600">
          Loss-day overlap pairs: {s.drawdownOverlap.slice(0, 4).map(p => `${p.a}×${p.b} ${(p.overlap * 100).toFixed(0)}%`).join(' · ')}
        </p>
      )}
    </Panel>
  )
}

// ─── run history ──────────────────────────────────────────────────────────────

function RunsPanel({ data }: { data: PaperValidationData }) {
  return (
    <Panel icon={Activity} title="Run health" right={
      <span className="text-[11px] text-gray-600">last run {relTime(data.lastRunAt)}</span>
    }>
      {data.runs.length === 0 ? (
        <EmptyState icon={Activity} title="No paper runs recorded" hint="The validation clock starts with the first scheduled run." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-gray-600">
                <th className="py-1 pr-2">When</th>
                <th className="px-2 text-right">Strategies</th>
                <th className="px-2 text-right">Opportunities</th>
                <th className="px-2 text-right">Opened</th>
                <th className="px-2 text-right">Closed</th>
                <th className="px-2 text-right">Errors</th>
                <th className="px-2">Regime</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((r, i) => (
                <tr key={i} className="border-b border-white/5 text-gray-300">
                  <td className="py-1 pr-2 text-gray-500">{relTime(r.runAt)}</td>
                  <td className="px-2 text-right tabular-nums">{r.strategiesRun}</td>
                  <td className="px-2 text-right tabular-nums">{r.opportunitiesFound}</td>
                  <td className="px-2 text-right tabular-nums">{r.positionsOpened}</td>
                  <td className="px-2 text-right tabular-nums">{r.positionsClosed}</td>
                  <td className={cn('px-2 text-right tabular-nums', r.errors > 0 ? 'text-amber-400' : '')}>{r.errors}</td>
                  <td className="px-2 text-gray-500">{r.regime ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

// ─── broker sandbox certification matrix (item 5) ─────────────────────────────

function BrokerReadinessPanel({ data }: { data: PaperValidationData }) {
  const rows = data.brokerReadiness
  return (
    <Panel icon={ShieldCheck} title="Broker sandbox certification" right={
      <span className="text-[11px] text-gray-600">certification records NEVER flip liveReady — that is a reviewed code change</span>
    }>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-gray-600">
              <th className="py-1 pr-2">Broker</th>
              <th className="px-2">Configured</th>
              <th className="px-2">Sandbox checks</th>
              <th className="px-2">Status</th>
              <th className="px-2">Certified by</th>
              <th className="px-2">liveReady</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.broker} className="border-b border-white/5" title={r.notes ?? undefined}>
                <td className="py-1 pr-2 font-medium text-gray-200">{r.displayName}</td>
                <td className="px-2 text-gray-500">{r.configured ? 'keys present' : '—'}</td>
                <td className="px-2 tabular-nums text-gray-400">{r.checksPassed}/{r.checksTotal}</td>
                <td className="px-2">
                  <Badge variant={r.status === 'certified_sandbox' ? 'info' : r.status === 'in_progress' ? 'warning' : 'default'}>
                    {r.status.replace(/_/g, ' ')}
                  </Badge>
                </td>
                <td className="px-2 text-gray-500">{r.certifiedBy ?? '—'}</td>
                <td className={cn('px-2 font-semibold', r.liveReady ? 'text-red-400' : 'text-emerald-400')}>
                  {r.liveReady ? 'TRUE — investigate' : 'false'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-gray-600">
        Pre-live sequence per broker: order placement → cancel → status → partial fill → rejection → bracket/OCO →
        reconciliation → quantity conversion, all against the broker&apos;s sandbox, then liveReady flips in a reviewed PR.
        No broker has completed any of it.
      </p>
    </Panel>
  )
}

// ─── strategy attribution (item 7) ────────────────────────────────────────────

function AttributionPanel({ cards }: { cards: PaperScorecard[] }) {
  const withData = cards.filter(c => c.attribution && c.closedTrades > 0)
  return (
    <Panel icon={GitBranch} title="Strategy attribution" right={
      <span className="text-[11px] text-gray-600">components without enough data say so — nothing is fabricated</span>
    }>
      {withData.length === 0 ? (
        <EmptyState icon={GitBranch} title="Not enough closed trades"
          hint="Attribution needs ≥5 closed trades per strategy. It appears as evidence accumulates." />
      ) : (
        <div className="space-y-2">
          {withData.slice(0, 10).map(c => {
            const a = c.attribution!
            const comp = (label: string, v: { valuePct: number | null; note: string }) => (
              <span className="mr-3 whitespace-nowrap" title={v.note}>
                <span className="text-gray-600">{label}</span>{' '}
                {v.valuePct == null
                  ? <span className="text-gray-600">n/a</span>
                  : <span className={cn('tabular-nums', v.valuePct > 0 ? 'text-emerald-400' : v.valuePct < 0 ? 'text-red-400' : 'text-gray-400')}>
                      {v.valuePct > 0 ? '+' : ''}{v.valuePct.toFixed(2)}%
                    </span>}
              </span>
            )
            return (
              <details key={c.strategyKey} className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
                <summary className="cursor-pointer text-[11px]">
                  <span className="font-medium text-gray-200">{c.strategyKey}</span>
                  <span className="ml-2 text-[10px] text-gray-500">
                    {comp('cost', a.costDrag)}
                    {comp('sizing', a.sizingContribution)}
                    {comp('veto', a.vetoBenefit)}
                    {comp('residual', a.residual)}
                  </span>
                </summary>
                <div className="mt-1.5 space-y-1 text-[10px] text-gray-500">
                  <p>Exit contribution: {a.exitContribution.valuePct != null ? `${a.exitContribution.valuePct}%` : 'n/a'} — {a.exitContribution.note}</p>
                  {a.exitBreakdown.length > 0 && (
                    <p>Exit mix: {a.exitBreakdown.map(x => `${x.reason} ×${x.count} (${x.avgReturnPct > 0 ? '+' : ''}${x.avgReturnPct}%)`).join(' · ')}</p>
                  )}
                  <p>Regime: {a.regimeContribution.note}</p>
                  <p>Synergy: {a.synergyEffect.note}</p>
                  <p>Residual: {a.residual.note}</p>
                </div>
              </details>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

// ─── fill model assumptions ───────────────────────────────────────────────────

function FillModelPanel({ data }: { data: PaperValidationData }) {
  const rows = Object.entries(data.fillModel)
  return (
    <Panel icon={FlaskConical} title="Fill model assumptions (deterministic)" right={
      <span className="text-[11px] text-amber-400/80">paper results understate live conditions by design</span>
    }>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-gray-600">
              <th className="py-1 pr-2">Asset class</th>
              <th className="px-2 text-right">Half-spread (bps)</th>
              <th className="px-2 text-right">Impact @ ref (bps)</th>
              <th className="px-2 text-right">Liquidity ref</th>
              <th className="px-2 text-right">Depth cap (partial above)</th>
              <th className="px-2 text-right">Reject above (bps)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([cls, p]) => (
              <tr key={cls} className="border-b border-white/5 text-gray-300">
                <td className="py-1 pr-2 font-medium text-gray-200">{cls}</td>
                <td className="px-2 text-right tabular-nums">{p.halfSpreadBps}</td>
                <td className="px-2 text-right tabular-nums">{p.impactBps}</td>
                <td className="px-2 text-right tabular-nums">{usd(p.liquidityRefUsd)}</td>
                <td className="px-2 text-right tabular-nums">{usd(p.depthCapUsd)}</td>
                <td className="px-2 text-right tabular-nums">{p.rejectAboveBps}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-gray-600">
        Every fill pays the half-spread plus linear impact scaled by order size ÷ liquidity ref. Orders above the depth cap
        fill partially; orders whose modeled cost exceeds the reject threshold are refused. There is NO
        &ldquo;actual vs model&rdquo; slippage comparison yet — that requires broker sandbox fills, which have not run.
      </p>
    </Panel>
  )
}

// ─── runbook checklist ────────────────────────────────────────────────────────

function ChecklistSection({ title, items }: { title: string; items: ChecklistItem[] }) {
  const [open, setOpen] = useState(true)
  const tone = (s: ChecklistItem['status']) =>
    s === 'pass' ? 'text-emerald-400' : s === 'fail' ? 'text-red-400'
      : s === 'pending' ? 'text-amber-400' : 'text-gray-500'
  const mark = (s: ChecklistItem['status']) =>
    s === 'pass' ? '✓' : s === 'fail' ? '✗' : s === 'pending' ? '…' : '☐'
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{title}</span>
        <span className="text-[10px] text-gray-600">
          {items.filter(i => i.status === 'pass').length}/{items.length} pass · {open ? 'hide' : 'show'}
        </span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5">
          {items.map(item => (
            <li key={item.id} className="text-[11px]">
              <span className={cn('mr-1.5 font-mono', tone(item.status))}>{mark(item.status)}</span>
              <span className="text-gray-300">{item.label}</span>
              <span className="ml-1.5 text-gray-600">— {item.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RunbookPanel({ data }: { data: PaperValidationData }) {
  const c = data.checklist
  return (
    <Panel icon={BookOpenCheck} title="Validation runbook" right={
      <span className="text-[11px] text-gray-600">docs/paper-trading-validation-runbook.md</span>
    }>
      {c.blockers.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400">Unresolved blockers</p>
          <ul className="space-y-0.5">
            {c.blockers.map((b, i) => (
              <li key={i} className="text-[11px] text-amber-200/90">• {b}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChecklistSection title="Weekly review" items={c.weeklyReview} />
        <ChecklistSection title="Pass / fail criteria" items={c.passFail} />
        <ChecklistSection title="Pre-live requirements" items={c.preLive} />
        <ChecklistSection title="Broker sandbox (all pending)" items={c.brokerSandbox} />
      </div>
    </Panel>
  )
}

// ─── page composition ─────────────────────────────────────────────────────────

export function PaperValidationClient({ data }: { data: PaperValidationData }) {
  const reviewReady = data.scorecards.filter(s =>
    s.validationStatus === 'review_ready' || s.validationStatus === 'promotion_ready').length
  const totalBlocked = data.scorecards.reduce((s, c) => s + c.blockedCount, 0)
  const totalVetoes = data.scorecards.reduce((s, c) => s + c.riskVetoCount, 0)

  return (
    <div className="min-h-full space-y-4 bg-bg-1 p-6">
      {data.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300">
          Data loader error: {data.error}
        </div>
      )}

      <SafetyStrip data={data} />

      {/* headline stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {[
          { label: 'Last paper run', value: relTime(data.lastRunAt) },
          { label: 'Open positions', value: String(data.openPositions.length) },
          { label: 'Strategies tracked', value: String(data.scorecards.length) },
          { label: 'Review-ready', value: String(reviewReady) },
          { label: 'Blocked (window)', value: String(totalBlocked) },
          { label: 'Risk vetoes', value: String(totalVetoes) },
        ].map(c => (
          <div key={c.label} className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-sm font-semibold tabular-nums text-gray-200">{c.value}</p>
            <p className="mt-0.5 text-[10px] text-gray-600">{c.label}</p>
          </div>
        ))}
      </div>

      <RunbookPanel data={data} />
      <ScorecardsPanel cards={data.scorecards} />
      <AttributionPanel cards={data.scorecards} />
      <CoveragePanel data={data} />
      <PositionsPanel data={data} />
      <SynergyPanel data={data} />
      <BrokerReadinessPanel data={data} />
      <RunsPanel data={data} />
      <FillModelPanel data={data} />

      <p className="pb-2 text-center text-[10px] text-gray-600">
        <ListChecks className="mr-1 inline h-3 w-3" />
        All results on this page come from the deterministic paper fill model. They are modeled, conservative estimates —
        not live fills, not broker confirmations, and not a projection of live performance.
      </p>
    </div>
  )
}
