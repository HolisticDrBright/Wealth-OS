'use client'

import { cn } from '@/lib/utils'
import type { ShadowPortfolioSummary, ShadowPosition } from '@/lib/actions/shadow-portfolio'
import { Ghost, TrendingUp, TrendingDown, Minus } from 'lucide-react'

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(usd: number): string {
  const abs = Math.abs(usd)
  const s = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${abs.toFixed(0)}`
  return usd < 0 ? `−${s}` : `+${s}`
}

function pct(v: number | null): string {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
}

function pnlClass(v: number | null): string {
  if (v == null) return 'text-gray-500'
  return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-gray-500'
}

function skipLabel(key: string): string {
  const map: Record<string, string> = {
    riskBlocked:       'Risk veto',
    profileBlocked:    'Profile mismatch',
    venueBlocked:      'Venue blocked',
    positionCapBlocked:'Position cap',
    liquidityBlocked:  'Liquidity',
    block:             'CIO block',
  }
  return map[key] ?? key.replace(/([A-Z])/g, ' $1').trim()
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── verdict helpers ───────────────────────────────────────────────────────────

function verdict(data: ShadowPortfolioSummary): { text: string; tone: 'pos' | 'neg' | 'neutral' } {
  const { totalShadowPnlUsd, totalRealPnlUsd, closedShadowPositions } = data

  if (closedShadowPositions < 3) {
    return { text: 'Not enough closed shadow positions to draw conclusions yet. Run more paper trading passes.', tone: 'neutral' }
  }

  const delta = totalRealPnlUsd - totalShadowPnlUsd

  if (Math.abs(delta) < 5) {
    return { text: 'Your decision gates are roughly neutral — accepted and rejected trades are performing similarly.', tone: 'neutral' }
  }

  if (delta > 0) {
    return {
      text: `Your gates are working. Accepted trades outperformed rejected ones by ${fmt(delta)}. Keep the filters.`,
      tone: 'pos',
    }
  }
  return {
    text: `Your gates may be too strict. Rejected trades outperformed accepted ones by ${fmt(-delta)}. Review the top skip reason.`,
    tone: 'neg',
  }
}

// ── stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, tone }: {
  label: string
  value: string
  sub?: string
  tone?: 'pos' | 'neg' | 'neutral' | 'muted'
}) {
  const cls = tone === 'pos' ? 'text-emerald-400'
    : tone === 'neg' ? 'text-red-400'
    : tone === 'muted' ? 'text-gray-600'
    : 'text-gray-200'
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-1">
      <p className="text-[11px] text-gray-600 uppercase tracking-wide">{label}</p>
      <p className={cn('text-2xl font-semibold tabular-nums', cls)}>{value}</p>
      {sub && <p className="text-xs text-gray-600">{sub}</p>}
    </div>
  )
}

// ── position row ──────────────────────────────────────────────────────────────

function PositionRow({ pos }: { pos: ShadowPosition }) {
  const pnl = pos.status === 'open' ? pos.unrealizedPnlUsd : pos.realizedPnlUsd
  const pnlPct = pos.status === 'open' ? pos.unrealizedPnlPct : pos.realizedPnlPct

  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
      <td className="py-2.5 px-3">
        <p className="text-xs font-medium text-gray-200">{pos.symbol}</p>
        <p className="text-[10px] text-gray-600">{pos.strategyLabel}</p>
      </td>
      <td className="py-2.5 px-3 text-[10px]">
        <span className={cn(
          'rounded-full px-2 py-0.5 font-medium',
          pos.direction === 'long' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400',
        )}>
          {pos.direction}
        </span>
      </td>
      <td className="py-2.5 px-3 text-xs text-gray-500">
        {skipLabel(pos.skipReason)}
      </td>
      <td className="py-2.5 px-3 text-xs tabular-nums text-gray-400">
        ${pos.wouldHavePrice.toFixed(4)}
      </td>
      <td className="py-2.5 px-3 text-xs tabular-nums text-gray-400">
        {pos.currentPrice != null ? `$${pos.currentPrice.toFixed(4)}` : '—'}
      </td>
      <td className={cn('py-2.5 px-3 text-xs tabular-nums font-medium', pnlClass(pnl))}>
        {pnl != null ? fmt(pnl) : '—'}
        {pnlPct != null && (
          <span className="ml-1 text-[10px]">({pct(pnlPct)})</span>
        )}
      </td>
      <td className="py-2.5 px-3">
        <span className={cn(
          'text-[10px] rounded-full px-2 py-0.5',
          pos.status === 'open' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-gray-500/10 text-gray-500',
        )}>
          {pos.status === 'open' ? 'Open' : (pos.exitReason ?? 'Closed')}
        </span>
      </td>
      <td className="py-2.5 px-3 text-[10px] text-gray-600">{relativeTime(pos.createdAt)}</td>
    </tr>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export function ShadowPortfolioClient({ data }: { data: ShadowPortfolioSummary }) {
  const v = verdict(data)
  const hasData = data.positions.length > 0

  const shadowPnlTone = data.totalShadowPnlUsd > 0 ? 'pos' : data.totalShadowPnlUsd < 0 ? 'neg' : 'muted'
  const realPnlTone   = data.totalRealPnlUsd > 0   ? 'pos' : data.totalRealPnlUsd < 0   ? 'neg' : 'muted'

  const VerdictIcon = v.tone === 'pos' ? TrendingUp : v.tone === 'neg' ? TrendingDown : Minus

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Ghost className="h-5 w-5 text-indigo-400" />
          <h1 className="text-xl font-semibold text-gray-100">Shadow Portfolio</h1>
        </div>
        <p className="text-sm text-gray-500">
          Tracking trades that Wealth OS declined — so you can see whether the decision gates are helping or hurting.
        </p>
      </div>

      {/* Verdict banner */}
      <div className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3',
        v.tone === 'pos' ? 'border-emerald-500/20 bg-emerald-500/5'
          : v.tone === 'neg' ? 'border-red-500/20 bg-red-500/5'
          : 'border-white/10 bg-white/[0.02]',
      )}>
        <VerdictIcon className={cn(
          'h-4 w-4 mt-0.5 shrink-0',
          v.tone === 'pos' ? 'text-emerald-400' : v.tone === 'neg' ? 'text-red-400' : 'text-gray-500',
        )} />
        <p className="text-sm text-gray-300 leading-relaxed">{v.text}</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Shadow P&L (rejected)"
          value={hasData ? fmt(data.totalShadowPnlUsd) : '—'}
          sub={data.shadowWinRate != null ? `${(data.shadowWinRate * 100).toFixed(0)}% win rate` : undefined}
          tone={shadowPnlTone}
        />
        <StatCard
          label="Real P&L (accepted)"
          value={hasData ? fmt(data.totalRealPnlUsd) : '—'}
          sub={data.realWinRate != null ? `${(data.realWinRate * 100).toFixed(0)}% win rate` : undefined}
          tone={realPnlTone}
        />
        <StatCard
          label="Shadow positions"
          value={String(data.openShadowPositions + data.closedShadowPositions)}
          sub={`${data.openShadowPositions} open · ${data.closedShadowPositions} closed`}
          tone="neutral"
        />
        <StatCard
          label="Top skip reason"
          value={data.topSkipReason ? skipLabel(data.topSkipReason) : '—'}
          sub={data.shadowAvgReturnPct != null ? `Avg shadow return ${pct(data.shadowAvgReturnPct)}` : undefined}
          tone="neutral"
        />
      </div>

      {/* Avg return comparison */}
      {(data.shadowAvgReturnPct != null || data.realAvgReturnPct != null) && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <p className="text-[11px] text-gray-600 uppercase tracking-wide mb-2">Average return per closed position</p>
            <div className="flex items-end gap-6">
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Shadow (rejected)</p>
                <p className={cn('text-xl font-semibold tabular-nums', pnlClass(data.shadowAvgReturnPct))}>
                  {pct(data.shadowAvgReturnPct)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Real (accepted)</p>
                <p className={cn('text-xl font-semibold tabular-nums', pnlClass(data.realAvgReturnPct))}>
                  {pct(data.realAvgReturnPct)}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <p className="text-[11px] text-gray-600 uppercase tracking-wide mb-2">How to interpret</p>
            <ul className="space-y-1.5 text-xs text-gray-500">
              <li className="flex gap-2"><span className="text-emerald-400">↑</span> Real beats Shadow → gates are filtering correctly</li>
              <li className="flex gap-2"><span className="text-red-400">↓</span> Shadow beats Real → gates may be too strict</li>
              <li className="flex gap-2"><span className="text-gray-500">≈</span> Similar returns → gates are neutral</li>
            </ul>
          </div>
        </div>
      )}

      {/* Positions table */}
      {!hasData ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] py-16 flex flex-col items-center gap-3">
          <Ghost className="h-8 w-8 text-gray-700" />
          <p className="text-sm text-gray-600">No shadow positions yet</p>
          <p className="text-xs text-gray-700 max-w-sm text-center">
            Shadow positions are created when the CIO pipeline blocks a tradeable opportunity.
            Run paper trading to start populating this view.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <p className="text-sm font-medium text-gray-300">Shadow positions ({data.positions.length})</p>
            <p className="text-[11px] text-gray-600">Tracking {data.openShadowPositions} live, {data.closedShadowPositions} resolved</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {['Symbol / Strategy', 'Dir', 'Skip reason', 'Entry price', 'Current', 'P&L', 'Status', 'Age'].map(h => (
                    <th key={h} className="py-2 px-3 text-left text-[10px] font-medium text-gray-600 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.positions.map(pos => <PositionRow key={pos.id} pos={pos} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
