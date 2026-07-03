'use client'

/**
 * TCA panel (R3a): realized vs modeled one-way cost per venue/strategy.
 * Red rows drift >25% from the model — those measured costs belong in
 * cost_overrides so the edge gate prices reality.
 */

import { Receipt } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TcaReport } from '@/lib/actions/tca-report'

export function TcaPanel({ report }: { report: TcaReport | null }) {
  if (!report) return null
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
        <Receipt className="h-4 w-4 text-indigo-400" /> Transaction cost analysis
        <span className="text-[10px] font-normal text-gray-600">{report.fills} fills · realized vs modeled one-way bps</span>
      </h3>
      {report.rows.length === 0 ? (
        <p className="mt-3 text-xs text-gray-500">Appears once fills record slippage.</p>
      ) : (
        <table className="mt-3 w-full font-mono text-[11px]">
          <thead>
            <tr className="text-left text-[10px] uppercase text-gray-600">
              <th className="pb-1">Venue</th><th className="pb-1">Strategy</th>
              <th className="pb-1">Realized</th><th className="pb-1">Model</th>
              <th className="pb-1">Drift</th><th className="pb-1">n</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r, i) => (
              <tr key={i} className={cn('border-t border-white/5', r.flagged && 'bg-red-500/5')}>
                <td className="py-0.5 text-gray-300">{r.assetClass}</td>
                <td className="py-0.5 text-gray-500">{r.strategyKey ?? 'ALL'}</td>
                <td className="py-0.5 tabular-nums text-gray-200">{r.realizedOneWayBps}</td>
                <td className="py-0.5 tabular-nums text-gray-500">{r.modeledOneWayBps}</td>
                <td className={cn('py-0.5 tabular-nums', r.flagged ? 'text-red-400 font-bold' : 'text-gray-400')}>
                  {r.driftPct > 0 ? '+' : ''}{r.driftPct}%{r.flagged ? ' ⚠' : ''}
                </td>
                <td className="py-0.5 tabular-nums text-gray-600">{r.fills}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
