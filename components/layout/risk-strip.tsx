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
import { AlertOctagon, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getRiskStripData, getHaltImpact, setTradingHalted,
  type RiskStripData, type HaltImpact,
} from '@/lib/actions/risk-strip'

const POLL_MS = 30_000
const RESUME_PHRASE = 'RESUME TRADING'

function fmtUsd(n: number): string {
  const abs = Math.abs(n)
  const s = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${abs.toFixed(0)}`
  return n < 0 ? `−${s}` : s
}

export function RiskStrip() {
  const [data, setData] = useState<RiskStripData | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [impact, setImpact] = useState<HaltImpact | null>(null)
  const [resumeText, setResumeText] = useState('')
  const [, startTransition] = useTransition()

  const refresh = useCallback(() => {
    startTransition(async () => {
      const d = await getRiskStripData().catch(() => null)
      if (d) setData(d)
    })
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  const openConfirm = async () => {
    setConfirming(true)
    setImpact(await getHaltImpact().catch(() => null))
  }

  const halt = async () => {
    await setTradingHalted(true, 'manual Flatten & Halt from the risk strip')
    setConfirming(false)
    refresh()
  }

  const resume = async () => {
    if (resumeText !== RESUME_PHRASE) return
    await setTradingHalted(false, '')
    setResumeText('')
    refresh()
  }

  if (!data) return null

  const halted = data.tradingHalted
  const ddRatio = data.maxDrawdownPct > 0 ? data.drawdownPct / data.maxDrawdownPct : 0
  const ddTone = ddRatio >= 1 ? 'text-red-400' : ddRatio >= 0.75 ? 'text-amber-400' : 'text-emerald-400'
  const lossBreached = data.dailyLossLimitUsd != null && data.dailyPnlUsd < 0 &&
    Math.abs(data.dailyPnlUsd) > data.dailyLossLimitUsd

  return (
    <div className={cn(
      'flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-1.5 text-[11px]',
      halted ? 'border-red-500/40 bg-red-950/40' : 'border-white/10 bg-white/[0.02]',
    )}>
      {/* PAPER/LIVE badge — never hidden by any layout state */}
      <span className={cn(
        'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
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
        today {fmtUsd(data.dailyPnlUsd)}
        {data.dailyLossLimitUsd != null && ` / −${fmtUsd(data.dailyLossLimitUsd)} limit`}
      </span>

      <span className="tabular-nums text-gray-500">{data.openPositions} open</span>

      <span className="hidden items-center gap-1.5 md:flex">
        {data.exposureByClass.slice(0, 4).map(e => (
          <span key={e.assetClass} className="rounded bg-white/5 px-1.5 py-0.5 text-gray-400">
            {e.assetClass} {fmtUsd(e.notionalUsd)}
          </span>
        ))}
      </span>

      <span className="ml-auto">
        {halted ? (
          <span className="flex items-center gap-1.5">
            <input
              value={resumeText}
              onChange={e => setResumeText(e.target.value)}
              placeholder={`type ${RESUME_PHRASE}`}
              className="w-40 rounded border border-red-500/40 bg-transparent px-1.5 py-0.5 text-[10px] text-red-200 placeholder:text-red-500/50"
            />
            <button
              onClick={resume}
              disabled={resumeText !== RESUME_PHRASE}
              className="rounded bg-red-500/20 px-2 py-0.5 font-semibold text-red-300 disabled:opacity-40"
            >
              Re-enable
            </button>
          </span>
        ) : (
          <button
            onClick={openConfirm}
            className="rounded bg-red-600/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-red-600"
          >
            Flatten &amp; Halt
          </button>
        )}
      </span>

      {/* Two-step confirm with impact summary */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-500/40 bg-[#0b0d13] p-5">
            <h3 className="flex items-center gap-2 text-sm font-bold text-red-400">
              <AlertOctagon className="h-4 w-4" /> Flatten &amp; Halt — confirm impact
            </h3>
            <div className="mt-3 space-y-1.5 text-xs text-gray-300">
              {impact ? (
                <>
                  <p>{impact.openPositions} open positions ({fmtUsd(impact.openNotionalUsd)}) will be closed by the runner.</p>
                  <p>Estimated exit costs: {fmtUsd(impact.estimatedExitCostUsd)} (per-venue spread + fees).</p>
                  <p>{impact.pendingOrders} pending order intent(s) will stop being placed.</p>
                  <p className="text-gray-500">The kill switch blocks every new order until you re-enable with typed confirmation.</p>
                </>
              ) : (
                <p className="text-gray-500">Computing impact…</p>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="rounded border border-white/10 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={halt}
                className="rounded bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500"
              >
                Halt all trading
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
