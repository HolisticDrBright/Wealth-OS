'use client'

import { cn } from '@/lib/utils'
import { Activity } from 'lucide-react'
import type { RegimeView } from '@/lib/actions/command-center'

const REGIME_META: Record<
  RegimeView['regime'],
  { label: string; text: string; bg: string; border: string; dot: string; blurb: string }
> = {
  RISK_ON: {
    label: 'Risk On',
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    dot: 'bg-emerald-400',
    blurb: 'Favorable conditions — directional strategies trade at full size.',
  },
  NEUTRAL: {
    label: 'Neutral',
    text: 'text-gray-300',
    bg: 'bg-white/5',
    border: 'border-white/10',
    dot: 'bg-gray-400',
    blurb: 'Mixed signals — no regime-wide size adjustment.',
  },
  RISK_OFF: {
    label: 'Risk Off',
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    dot: 'bg-amber-400',
    blurb: 'Elevated stress — directional strategies are sized down.',
  },
  CRISIS: {
    label: 'Crisis',
    text: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    dot: 'bg-red-400',
    blurb: 'Severe stress — only tail-risk hedges trade.',
  },
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!isFinite(then)) return 'unknown'
  const diffMin = Math.round((Date.now() - then) / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const h = Math.round(diffMin / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function RegimeBanner({ regime }: { regime: RegimeView }) {
  const meta = REGIME_META[regime.regime] ?? REGIME_META.NEUTRAL
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border p-4', meta.bg, meta.border)}>
      <div className="flex items-center gap-2">
        <Activity className={cn('h-4 w-4', meta.text)} />
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Market Regime</span>
        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-semibold', meta.text, meta.bg, meta.border)}>
          <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
          {meta.label}
        </span>
      </div>
      <p className="min-w-0 flex-1 truncate text-xs text-gray-400">{meta.blurb}</p>
      <div className="flex items-center gap-3 text-xs tabular-nums">
        <span className="text-gray-500">
          VIX{' '}
          <span className="font-semibold text-gray-300">
            {regime.vix != null ? regime.vix.toFixed(1) : '—'}
          </span>
        </span>
        <span className="text-gray-500">
          HY OAS{' '}
          <span className="font-semibold text-gray-300">
            {regime.hyOas != null ? `${regime.hyOas.toFixed(0)}bps` : '—'}
          </span>
        </span>
        <span className="text-gray-600" title={new Date(regime.asOf).toLocaleString()}>
          as of {relativeTime(regime.asOf)}
        </span>
      </div>
    </div>
  )
}
