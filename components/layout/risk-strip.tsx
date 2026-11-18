'use client'

/**
 * Risk Strip — always-visible safety header on every authenticated page
 * (UI brief widget 1) + the global Flatten & Halt button (widget 3).
 *
 * Polls every 30s (position-monitor cadence). When trading_halted is set the
 * whole strip turns red with the reason. The PAPER/LIVE badge can never be
 * hidden: amber for paper, red for live.
 */

import { useCallback, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertOctagon, AlertTriangle, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getRiskStripData, getHaltImpact, setTradingHalted, flattenAndHalt,
  type RiskStripData, type HaltImpact,
} from '@/lib/actions/risk-strip'
import { DensityToggle } from '@/components/layout/density-provider'
import { setUiMode, type UiMode } from '@/lib/actions/ui-prefs'
import { TrendArrow } from '@/components/ui/trend-arrow'

const POLL_MS = 30_000
const RESUME_PHRASE = 'RESUME TRADING'

function fmtUsd(n: number): string {
  const abs = Math.abs(n)
  const s = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${abs.toFixed(0)}`
  return n < 0 ? `−${s}` : s
}

/** Phase 3.1: Simple/Pro switch lives in the always-visible risk strip. */
function ModeToggle({ uiMode }: { uiMode: UiMode }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const next: UiMode = uiMode === 'simple' ? 'pro' : 'simple'
  return (
    <button
      onClick={async () => {
        setBusy(true)
        try { await setUiMode(next); router.refresh() } finally { setBusy(false) }
      }}
      disabled={busy}
      aria-label={`Switch to ${next} mode`}
      title={uiMode === 'simple' ? 'Show the full pro dashboard' : 'Show the simple view'}
      className="rounded border border-line-strong px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-text-1 hover:bg-white/5 hover:text-white disabled:opacity-40"
    >
      {uiMode === 'simple' ? 'Simple' : 'Pro'}
    </button>
  )
}

export function RiskStrip({ uiMode = 'pro' }: { uiMode?: UiMode }) {
  const [data, setData] = useState<RiskStripData | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [impact, setImpact] = useState<HaltImpact | null>(null)
  const [resumeText, setResumeText] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [, startTransition] = useTransition()

  const refresh = useCallback(() => {
    startTransition(async () => {
      const d = await getRiskStripData().catch(() => null)
      if (d) {
        setData(d)
        setLoadFailed(false)
      } else {
        // Keep stale data if we have it; flag the failure either way.
        setLoadFailed(true)
      }
    })
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  const openConfirm = async () => {
    setActionError(null)
    setConfirming(true)
    setImpact(await getHaltImpact().catch(() => null))
  }

  const halt = async () => {
    setActionBusy(true)
    setActionError(null)
    try {
      const res = await flattenAndHalt('manual Flatten & Halt from the risk strip')
      if (!res.ok) {
        // Trading is still halted (flag is set first); show what failed and
        // keep the dialog open so the user sees it.
        setActionError(
          res.error
            ? `Halt failed: ${res.error}`
            : `Trading is halted and ${res.closed} position(s) closed, but some could not be closed: ${res.failures.join('; ')}`
        )
        return
      }
      setConfirming(false)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Halt failed')
    } finally {
      setActionBusy(false)
      refresh()
    }
  }

  const resume = async () => {
    if (resumeText !== RESUME_PHRASE) return
    setActionBusy(true)
    setActionError(null)
    try {
      const res = await setTradingHalted(false, '')
      if (!res.ok) {
        setActionError(`Resume failed: ${res.error ?? 'unknown error'}`)
        return
      }
      setResumeText('')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Resume failed')
    } finally {
      setActionBusy(false)
      refresh()
    }
  }

  // Risk data unavailable: never render nothing — the user must still see a
  // visible warning AND keep access to the halt button.
  if (!data) {
    if (!loadFailed) return null   // first load still in flight
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-amber-500/40 bg-amber-950/30 px-4 py-1.5 text-xs">
        <span className="flex items-center gap-1.5 font-semibold text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          risk data unavailable — limits are still enforced server-side
        </span>
        {actionError && <span className="text-red-400">{actionError}</span>}
        <span className="ml-auto">
          <button
            onClick={openConfirm}
            className="rounded bg-red-600/80 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white hover:bg-red-600"
          >
            Flatten &amp; Halt
          </button>
        </span>
        {confirming && (
          <HaltConfirmDialog
            impact={impact}
            actionError={actionError}
            busy={actionBusy}
            onCancel={() => setConfirming(false)}
            onHalt={halt}
          />
        )}
      </div>
    )
  }

  const halted = data.tradingHalted
  const ddRatio = data.maxDrawdownPct > 0 ? data.drawdownPct / data.maxDrawdownPct : 0
  const ddTone = ddRatio >= 1 ? 'text-red-400' : ddRatio >= 0.75 ? 'text-amber-400' : 'text-emerald-400'
  const lossBreached = data.dailyLossLimitUsd != null && data.dailyPnlUsd < 0 &&
    Math.abs(data.dailyPnlUsd) > data.dailyLossLimitUsd

  return (
    <div className={cn(
      'flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-1.5 text-xs',
      halted ? 'border-red-500/40 bg-red-950/40' : 'border-line-strong bg-white/[0.02]',
    )}>
      {/* PAPER/LIVE badge — never hidden by any layout state */}
      <span className={cn(
        'rounded px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider',
        data.mode === 'paper' ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400',
      )}>
        {data.mode}
      </span>

      {halted ? (
        <span className="flex items-center gap-1.5 font-semibold text-red-400">
          <AlertOctagon className="h-3.5 w-3.5" />
          TRADING HALTED{data.haltReason ? ` — ${data.haltReason}` : ''}
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-gray-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> kill switch armed
        </span>
      )}

      <span className={cn('tabular-nums', ddTone)}>
        DD {data.drawdownPct.toFixed(1)}% / {data.maxDrawdownPct}%
      </span>

      <span className={cn('tabular-nums', lossBreached ? 'text-red-400' : data.dailyPnlUsd < 0 ? 'text-amber-400' : 'text-emerald-400')}>
        today <TrendArrow value={data.dailyPnlUsd} />{fmtUsd(data.dailyPnlUsd)}
        {data.dailyLossLimitUsd != null && ` / −${fmtUsd(data.dailyLossLimitUsd)} limit`}
      </span>

      <span className="tabular-nums text-gray-500">{data.openPositions} open</span>

      <span className="hidden items-center gap-1.5 md:flex">
        {data.exposureByClass.slice(0, 4).map(e => (
          <span key={e.assetClass} className="rounded bg-white/5 px-1.5 py-0.5 text-text-1">
            {e.assetClass} {fmtUsd(e.notionalUsd)}
          </span>
        ))}
      </span>

      {loadFailed && (
        <span className="flex items-center gap-1 text-amber-400">
          <AlertTriangle className="h-3 w-3" /> refresh failed — showing last data
        </span>
      )}
      {actionError && !confirming && <span className="text-red-400">{actionError}</span>}

      <span className="ml-auto flex items-center gap-2">
        <ModeToggle uiMode={uiMode} />
        <DensityToggle />
        {halted ? (
          <span className="flex items-center gap-1.5">
            <input
              value={resumeText}
              onChange={e => setResumeText(e.target.value)}
              placeholder={`type ${RESUME_PHRASE}`}
              className="w-40 rounded border border-red-500/40 bg-transparent px-1.5 py-0.5 text-xs text-red-200 placeholder:text-red-500/50"
            />
            <button
              onClick={resume}
              disabled={resumeText !== RESUME_PHRASE || actionBusy}
              className="rounded bg-red-500/20 px-2 py-0.5 font-semibold text-red-300 disabled:opacity-40"
            >
              {actionBusy ? 'Re-enabling…' : 'Re-enable'}
            </button>
          </span>
        ) : (
          <button
            onClick={openConfirm}
            className="rounded bg-red-600/80 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white hover:bg-red-600"
          >
            Flatten &amp; Halt
          </button>
        )}
      </span>

      {/* Two-step confirm with impact summary */}
      {confirming && (
        <HaltConfirmDialog
          impact={impact}
          actionError={actionError}
          busy={actionBusy}
          onCancel={() => setConfirming(false)}
          onHalt={halt}
        />
      )}
    </div>
  )
}

function HaltConfirmDialog({ impact, actionError, busy, onCancel, onHalt }: {
  impact: HaltImpact | null
  actionError: string | null
  busy: boolean
  onCancel: () => void
  onHalt: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-red-500/40 bg-bg-1 p-5">
        <h3 className="flex items-center gap-2 text-sm font-bold text-red-400">
          <AlertOctagon className="h-4 w-4" /> Flatten &amp; Halt — confirm impact
        </h3>
        <div className="mt-3 space-y-1.5 text-xs text-gray-300">
          {impact ? (
            <>
              <p>{impact.openPositions} open paper position(s) ({fmtUsd(impact.openNotionalUsd)}) will be closed NOW at current prices.</p>
              <p>Estimated exit costs: {fmtUsd(impact.estimatedExitCostUsd)} (per-venue spread + fees).</p>
              <p>{impact.pendingOrders} pending order intent(s) will stop being placed.</p>
              <p className="text-gray-500">The kill switch blocks every new order until you re-enable with typed confirmation.</p>
              <p className="text-gray-500">Live brokerage positions are out of scope — Wealth OS has no live trading; this closes paper positions only.</p>
            </>
          ) : (
            <p className="text-gray-500">Computing impact…</p>
          )}
          {actionError && (
            <p className="rounded border border-red-500/40 bg-red-950/40 p-2 text-red-300">{actionError}</p>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded border border-line-strong px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onHalt}
            disabled={busy}
            className="rounded bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-40"
          >
            {busy ? 'Closing positions…' : 'Halt all trading'}
          </button>
        </div>
      </div>
    </div>
  )
}
