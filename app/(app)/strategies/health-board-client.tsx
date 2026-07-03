'use client'

/**
 * Strategy Health Board — dense, auditable board of every strategy's maturity,
 * enablement, metrics, integrations, and the reason it is (or isn't) trading.
 *
 * Also hosts the segmented tab switch between the board and the existing
 * Configure surface (AIStrategiesClient), so the page server component can fetch
 * both data sets and hand them off without modifying the Configure component.
 */

import { useMemo, useState, type ComponentProps } from 'react'
import {
  CheckCircle2, Minus, Lock, ArrowUpDown, AlertTriangle, PlugZap,
} from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import {
  assetClassLabel, edgeTypeLabel, isInert, MATURITY_META,
} from '@/lib/strategies/strategy-display'
import { tradeabilityFromMaturity, allowsExecute } from '@/lib/opportunities/tradeability'
import { MaturityBadge } from '@/components/strategies/MaturityBadge'
import { CalibrationBadge, brierToLevel } from '@/components/risk/RiskBadges'
import { EmptyState, InsufficientData } from '@/components/ui/states'
import type {
  AssetClass, StrategyMaturityStatus,
} from '@/lib/strategies/strategy-registry'
import { ALL_BOOKS, BOOK_META, type StrategyBook } from '@/lib/strategies/strategy-books'
import type { StrategyHealthRow } from '@/lib/actions/strategy-health'
import type { BookAllocationView } from '@/lib/actions/book-exposure'
import type { PromotionPipelineRow } from '@/lib/actions/promotion-readiness'
import { AIStrategiesClient } from './ai-strategies-client'
import { BookAllocationPanel } from './BookAllocationPanel'
import { PromotionPipelinePanel } from './PromotionPipelinePanel'
import { LeaderboardPanel } from './LeaderboardPanel'
import type { StrategyMetrics } from '@/lib/actions/strategy-metrics'

// ─── Tabs shell ───────────────────────────────────────────────────────────────

type AIStrategiesProps = ComponentProps<typeof AIStrategiesClient>

export function StrategiesTabs({
  rows,
  configureProps,
  bookAllocation = null,
  promotionPipeline = [],
  metrics = [],
}: {
  rows: StrategyHealthRow[]
  configureProps: AIStrategiesProps
  bookAllocation?: BookAllocationView | null
  promotionPipeline?: PromotionPipelineRow[]
  metrics?: StrategyMetrics[]
}) {
  const [tab, setTab] = useState<'health' | 'configure'>('health')

  return (
    <div className="px-4 py-4 sm:px-6">
      <div className="mb-4 inline-flex rounded-lg border border-white/10 bg-white/5 p-0.5 text-sm">
        <button
          onClick={() => setTab('health')}
          className={cn(
            'rounded-md px-3 py-1.5 font-medium transition-colors',
            tab === 'health' ? 'bg-indigo-500/20 text-indigo-300' : 'text-gray-400 hover:text-gray-200',
          )}
        >
          Health Board
        </button>
        <button
          onClick={() => setTab('configure')}
          className={cn(
            'rounded-md px-3 py-1.5 font-medium transition-colors',
            tab === 'configure' ? 'bg-indigo-500/20 text-indigo-300' : 'text-gray-400 hover:text-gray-200',
          )}
        >
          Configure
        </button>
      </div>

      {tab === 'health'
        ? (
          <div className="space-y-3">
            {bookAllocation && <BookAllocationPanel data={bookAllocation} />}
            <LeaderboardPanel metrics={metrics} />
            <PromotionPipelinePanel rows={promotionPipeline} />
            <HealthBoard rows={rows} />
          </div>
        )
        : <AIStrategiesClient {...configureProps} />}
    </div>
  )
}

// ─── Filters ────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'maturity' | 'pnl30d' | 'tradeCount' | 'sharpe'

const ASSET_CLASSES: AssetClass[] = ['stocks', 'options', 'crypto', 'forex', 'polymarket', 'multi-asset']
const MATURITY_STATUSES = Object.keys(MATURITY_META) as StrategyMaturityStatus[]

function Chip({
  active, onClick, children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-md border px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors',
        active
          ? 'border-indigo-500/30 bg-indigo-500/15 text-indigo-300'
          : 'border-white/10 bg-white/5 text-gray-400 hover:text-gray-200',
      )}
    >
      {children}
    </button>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      {children}
    </div>
  )
}

// ─── Board ──────────────────────────────────────────────────────────────────

function HealthBoard({ rows }: { rows: StrategyHealthRow[] }) {
  const [assetFilter, setAssetFilter] = useState<AssetClass | 'all'>('all')
  const [bookFilter, setBookFilter] = useState<StrategyBook | 'all'>('all')
  const [maturityFilter, setMaturityFilter] = useState<StrategyMaturityStatus | 'all'>('all')
  const [enabledOnly, setEnabledOnly] = useState(false)
  const [paperOnly, setPaperOnly] = useState(false)
  const [liveEligibleOnly, setLiveEligibleOnly] = useState(false)
  const [needsReview, setNeedsReview] = useState(false)
  const [missingData, setMissingData] = useState(false)

  const [sortKey, setSortKey] = useState<SortKey>('maturity')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const filtered = useMemo(() => {
    const out = rows.filter(r => {
      if (assetFilter !== 'all' && r.assetClass !== assetFilter) return false
      if (bookFilter !== 'all' && r.book !== bookFilter) return false
      if (maturityFilter !== 'all' && r.maturityStatus !== maturityFilter) return false
      if (enabledOnly && !r.isEnabled) return false
      if (paperOnly && !r.paperEnabled) return false
      if (liveEligibleOnly && !MATURITY_META[r.maturityStatus].liveEligible) return false
      if (needsReview && r.maturityStatus !== 'live_candidate') return false
      if (missingData && r.missingRequired.length === 0) return false
      return true
    })

    const dir = sortDir === 'asc' ? 1 : -1
    out.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return dir * a.displayName.localeCompare(b.displayName)
        case 'maturity': {
          const d = MATURITY_META[a.maturityStatus].rank - MATURITY_META[b.maturityStatus].rank
          return d !== 0 ? dir * d : a.displayName.localeCompare(b.displayName)
        }
        case 'pnl30d':
          return dir * ((a.pnl30d ?? -Infinity) - (b.pnl30d ?? -Infinity))
        case 'tradeCount':
          return dir * ((a.tradeCount ?? -Infinity) - (b.tradeCount ?? -Infinity))
        case 'sharpe':
          return dir * ((a.sharpe ?? -Infinity) - (b.sharpe ?? -Infinity))
        default:
          return 0
      }
    })
    return out
  }, [rows, assetFilter, bookFilter, maturityFilter, enabledOnly, paperOnly, liveEligibleOnly, needsReview, missingData, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="space-y-2.5 rounded-xl border border-white/10 bg-white/5 p-3">
        <FilterGroup label="Asset">
          <Chip active={assetFilter === 'all'} onClick={() => setAssetFilter('all')}>All</Chip>
          {ASSET_CLASSES.map(ac => (
            <Chip key={ac} active={assetFilter === ac} onClick={() => setAssetFilter(ac)}>
              {assetClassLabel(ac)}
            </Chip>
          ))}
        </FilterGroup>

        <FilterGroup label="Book">
          <Chip active={bookFilter === 'all'} onClick={() => setBookFilter('all')}>All</Chip>
          {ALL_BOOKS.map(b => (
            <Chip key={b} active={bookFilter === b} onClick={() => setBookFilter(b)}>
              {BOOK_META[b].label}
            </Chip>
          ))}
        </FilterGroup>

        <FilterGroup label="Maturity">
          <Chip active={maturityFilter === 'all'} onClick={() => setMaturityFilter('all')}>All</Chip>
          {MATURITY_STATUSES.map(s => (
            <Chip key={s} active={maturityFilter === s} onClick={() => setMaturityFilter(s)}>
              {MATURITY_META[s].label}
            </Chip>
          ))}
        </FilterGroup>

        <FilterGroup label="Toggles">
          <Chip active={enabledOnly} onClick={() => setEnabledOnly(v => !v)}>Enabled</Chip>
          <Chip active={paperOnly} onClick={() => setPaperOnly(v => !v)}>Paper only</Chip>
          <Chip active={liveEligibleOnly} onClick={() => setLiveEligibleOnly(v => !v)}>Live eligible</Chip>
          <Chip active={needsReview} onClick={() => setNeedsReview(v => !v)}>Needs review</Chip>
          <Chip active={missingData} onClick={() => setMissingData(v => !v)}>Missing data</Chip>
        </FilterGroup>

        <div className="text-xs text-gray-500">
          Showing <span className="font-semibold text-gray-300">{filtered.length}</span> of {rows.length} strategies
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No strategies match these filters" hint="Loosen the filters above to see more strategies." />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-xl border border-white/10 bg-white/5 sm:block">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <Th onClick={() => toggleSort('name')} sortable active={sortKey === 'name'} dir={sortDir}>Strategy</Th>
                  <Th>Asset</Th>
                  <Th>Edge</Th>
                  <Th onClick={() => toggleSort('maturity')} sortable active={sortKey === 'maturity'} dir={sortDir}>Maturity</Th>
                  <Th>Enabled</Th>
                  <Th>Paper</Th>
                  <Th>Live</Th>
                  <Th onClick={() => toggleSort('pnl30d')} sortable active={sortKey === 'pnl30d'} dir={sortDir} className="text-right">30d P&amp;L</Th>
                  <Th>Brier</Th>
                  <Th onClick={() => toggleSort('sharpe')} sortable active={sortKey === 'sharpe'} dir={sortDir} className="text-right">Sharpe</Th>
                  <Th className="text-right">Max DD</Th>
                  <Th onClick={() => toggleSort('tradeCount')} sortable active={sortKey === 'tradeCount'} dir={sortDir} className="text-right">Trades</Th>
                  <Th>Last signal</Th>
                  <Th>Last calib</Th>
                  <Th>Integrations</Th>
                  <Th>Why</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => <Row key={r.key} row={r} />)}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 sm:hidden">
            {filtered.map(r => <MobileCard key={r.key} row={r} />)}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Table primitives ─────────────────────────────────────────────────────────

function Th({
  children, onClick, sortable, active, dir, className,
}: {
  children?: React.ReactNode
  onClick?: () => void
  sortable?: boolean
  active?: boolean
  dir?: 'asc' | 'desc'
  className?: string
}) {
  return (
    <th className={cn('px-3 py-2 font-medium', className)}>
      {sortable ? (
        <button
          onClick={onClick}
          className={cn('inline-flex items-center gap-1 hover:text-gray-300', active && 'text-gray-300')}
          title={`Sort by ${typeof children === 'string' ? children : 'column'}`}
        >
          {children}
          <ArrowUpDown className={cn('h-3 w-3', active ? 'opacity-100' : 'opacity-40')} />
          {active && <span className="text-[9px]">{dir === 'asc' ? '↑' : '↓'}</span>}
        </button>
      ) : children}
    </th>
  )
}

function BoolDot({ on, label }: { on: boolean; label: string }) {
  return on
    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-label={`${label}: yes`} />
    : <Minus className="h-3.5 w-3.5 text-gray-600" aria-label={`${label}: no`} />
}

function Pnl({ value }: { value: number | null }) {
  if (value == null) return <InsufficientData label="—" />
  const tone = value > 0 ? 'text-emerald-400' : value < 0 ? 'text-red-400' : 'text-gray-400'
  return <span className={cn('tabular-nums', tone)}>{formatCurrency(value)}</span>
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function IntegrationCell({ row }: { row: StrategyHealthRow }) {
  if (row.missingRequired.length === 0 && row.missingOptional.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-400" title="All integrations configured">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Ready
      </span>
    )
  }
  return (
    <div className="flex flex-wrap gap-1">
      {row.missingRequired.map(v => (
        <span
          key={v}
          title={`Required integration missing: ${v}`}
          className="inline-flex items-center gap-1 rounded border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400"
        >
          <AlertTriangle className="h-2.5 w-2.5" /> {v}
        </span>
      ))}
      {row.missingOptional.map(v => (
        <span
          key={v}
          title={`Optional integration missing: ${v}`}
          className="inline-flex items-center gap-1 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400"
        >
          <PlugZap className="h-2.5 w-2.5" /> {v}
        </span>
      ))}
    </div>
  )
}

function Row({ row }: { row: StrategyHealthRow }) {
  const inert = isInert(row.maturityStatus)
  const liveTradeable = allowsExecute(tradeabilityFromMaturity(row.maturityStatus, { liveEnabled: row.liveEnabled }))
  const brier = brierToLevel(row.brier)

  return (
    <tr className={cn('border-b border-white/5 last:border-0 hover:bg-white/5', inert && 'opacity-70')}>
      <td className="max-w-[220px] px-3 py-2">
        <span className="block truncate font-medium text-gray-100" title={row.displayName}>{row.displayName}</span>
      </td>
      <td className="px-3 py-2 text-gray-400">{assetClassLabel(row.assetClass)}</td>
      <td className="px-3 py-2 text-gray-400">{edgeTypeLabel(row.edgeType)}</td>
      <td className="px-3 py-2"><MaturityBadge status={row.maturityStatus} /></td>
      <td className="px-3 py-2"><BoolDot on={row.isEnabled} label="Enabled" /></td>
      <td className="px-3 py-2"><BoolDot on={row.paperEnabled} label="Paper" /></td>
      <td className="px-3 py-2">
        {inert
          ? <Lock className="h-3.5 w-3.5 text-gray-600" aria-label="Not tradable" />
          : <BoolDot on={liveTradeable && row.liveEnabled} label="Live" />}
      </td>
      <td className="px-3 py-2 text-right"><Pnl value={row.pnl30d} /></td>
      <td className="px-3 py-2">
        {row.brier == null
          ? <InsufficientData />
          : <CalibrationBadge level={brier.level} value={brier.value} />}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-300">
        {row.sharpe == null ? <InsufficientData label="—" /> : row.sharpe.toFixed(2)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-300">
        {row.maxDrawdown == null ? <InsufficientData label="—" /> : `${(row.maxDrawdown * 100).toFixed(1)}%`}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-300">
        {row.tradeCount == null ? <InsufficientData label="—" /> : row.tradeCount}
      </td>
      <td className="px-3 py-2 text-gray-400">
        {shortDate(row.lastSignal) ?? <InsufficientData label="—" />}
      </td>
      <td className="px-3 py-2 text-gray-400">
        {shortDate(row.lastCalibration) ?? <InsufficientData label="—" />}
      </td>
      <td className="px-3 py-2"><IntegrationCell row={row} /></td>
      <td className="max-w-[200px] px-3 py-2">
        <span className="block truncate text-xs text-gray-400" title={row.whyText}>{row.whyText}</span>
      </td>
    </tr>
  )
}

// ─── Mobile card ────────────────────────────────────────────────────────────

function MobileCard({ row }: { row: StrategyHealthRow }) {
  const inert = isInert(row.maturityStatus)
  const liveTradeable = allowsExecute(tradeabilityFromMaturity(row.maturityStatus, { liveEnabled: row.liveEnabled }))
  const brier = brierToLevel(row.brier)

  return (
    <div className={cn('rounded-xl border border-white/10 bg-white/5 p-3', inert && 'opacity-70')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-gray-100" title={row.displayName}>{row.displayName}</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {assetClassLabel(row.assetClass)} · {edgeTypeLabel(row.edgeType)}
          </p>
        </div>
        <MaturityBadge status={row.maturityStatus} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
        <span className="inline-flex items-center gap-1"><BoolDot on={row.isEnabled} label="Enabled" /> Enabled</span>
        <span className="inline-flex items-center gap-1"><BoolDot on={row.paperEnabled} label="Paper" /> Paper</span>
        <span className="inline-flex items-center gap-1">
          {inert
            ? <Lock className="h-3.5 w-3.5 text-gray-600" aria-label="Not tradable" />
            : <BoolDot on={liveTradeable && row.liveEnabled} label="Live" />}
          Live
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <Metric label="30d P&L"><Pnl value={row.pnl30d} /></Metric>
        <Metric label="Brier">
          {row.brier == null ? <InsufficientData /> : <CalibrationBadge level={brier.level} value={brier.value} />}
        </Metric>
        <Metric label="Sharpe">
          {row.sharpe == null ? <InsufficientData label="—" /> : <span className="tabular-nums text-gray-300">{row.sharpe.toFixed(2)}</span>}
        </Metric>
        <Metric label="Max DD">
          {row.maxDrawdown == null ? <InsufficientData label="—" /> : <span className="tabular-nums text-gray-300">{(row.maxDrawdown * 100).toFixed(1)}%</span>}
        </Metric>
        <Metric label="Trades">
          {row.tradeCount == null ? <InsufficientData label="—" /> : <span className="tabular-nums text-gray-300">{row.tradeCount}</span>}
        </Metric>
        <Metric label="Last signal">
          {shortDate(row.lastSignal) ?? <InsufficientData label="—" />}
        </Metric>
      </div>

      <div className="mt-2"><IntegrationCell row={row} /></div>
      <p className="mt-2 text-xs text-gray-400">{row.whyText}</p>
    </div>
  )
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  )
}
