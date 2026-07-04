'use client'

/**
 * Daily/weekly wealth brief (upgrade item 10) — mobile-first, dense, honest
 * "nothing urgent" state. Shared by /dashboard and /advisor.
 */

import { Newspaper, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WealthBrief } from '@/lib/advisory/brief'

function Row({ title, detail, tone }: { title: string; detail: string; tone: 'urgent' | 'normal' }) {
  return (
    <li className="py-1">
      <p className={cn('text-[11px] font-medium', tone === 'urgent' ? 'text-amber-300' : 'text-gray-200')}>{title}</p>
      <p className="text-[10px] leading-relaxed text-gray-500">{detail}</p>
    </li>
  )
}

export function BriefPanel({ brief }: { brief: WealthBrief }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
          <Newspaper className="h-3.5 w-3.5" /> Today&apos;s brief
        </h2>
        <span className="text-[10px] text-gray-600">{brief.generatedAt.slice(0, 16).replace('T', ' ')}</span>
      </div>

      {brief.riskAlerts.length > 0 && (
        <ul className="mb-2 space-y-0.5">
          {brief.riskAlerts.map((a, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] text-red-300">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {a}
            </li>
          ))}
        </ul>
      )}

      {brief.nothingUrgent ? (
        <p className="flex items-center gap-1.5 text-[11px] text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" /> Nothing urgent today.
        </p>
      ) : brief.urgent.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400">Urgent</p>
          <ul className="divide-y divide-white/5">
            {brief.urgent.map(u => <Row key={u.id} title={u.title} detail={u.detail} tone="urgent" />)}
          </ul>
        </div>
      )}

      {brief.moneyMoves.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Money moves to consider</p>
          <ul className="divide-y divide-white/5">
            {brief.moneyMoves.slice(0, 4).map(m => <Row key={m.id} title={m.title} detail={m.detail} tone="normal" />)}
          </ul>
        </div>
      )}

      {brief.deadlines.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Coming up</p>
          <ul className="divide-y divide-white/5">
            {brief.deadlines.slice(0, 4).map(d => <Row key={d.id} title={d.title} detail={d.detail} tone="normal" />)}
          </ul>
        </div>
      )}

      {brief.staleData.length > 0 && (
        <p className="mb-1 text-[10px] text-amber-400/80">{brief.staleData.join(' · ')}</p>
      )}
      <p className="text-[10px] text-gray-600">{brief.paperStatus}</p>
    </section>
  )
}
