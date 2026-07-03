'use client'

/**
 * Reliability diagram (widget 7): predicted confidence vs realized win rate.
 * Perfect calibration sits on the diagonal; above = underconfident, below =
 * overconfident. Plus the EXACT win-probability the empirical-Kelly sizer is
 * using per strategy right now.
 */

import { Target } from 'lucide-react'
import {
  ResponsiveContainer, ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import type { CalibrationReliabilityView } from '@/lib/actions/calibration-reliability'

export function ReliabilityPanel({ data }: { data: CalibrationReliabilityView | null }) {
  if (!data) return null

  const diagonal = [{ predicted: 0, realized: 0 }, { predicted: 1, realized: 1 }]

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
        <Target className="h-4 w-4 text-indigo-400" /> Calibration reliability
        <span className="text-[10px] font-normal text-gray-600">
          {data.gradedDecisions} graded decisions — the diagonal is perfect calibration
        </span>
      </h3>

      {data.buckets.length === 0 ? (
        <p className="mt-3 text-xs text-gray-500">
          Appears once decisions are graded (decision_log → outcome_log).
        </p>
      ) : (
        <div className="mt-3 h-52" style={{ minHeight: 208 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="predicted" type="number" domain={[0, 1]}
                tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false}
                label={{ value: 'predicted', position: 'insideBottom', fontSize: 10, fill: '#4b5563' }} />
              <YAxis dataKey="realized" type="number" domain={[0, 1]}
                tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} width={30} />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                formatter={(v, name) => [Number(v).toFixed(2), name === 'realized' ? 'Realized win rate' : String(name)]}
              />
              <Line data={diagonal} dataKey="realized" stroke="rgba(255,255,255,0.2)"
                strokeDasharray="4 4" dot={false} isAnimationActive={false} />
              <Scatter data={data.buckets} dataKey="realized" fill="#818cf8" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {data.sizerInputs.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-600">
            Empirical-Kelly sizer inputs (live)
          </p>
          <table className="mt-1.5 w-full font-mono text-[11px]">
            <thead>
              <tr className="text-left text-[10px] uppercase text-gray-600">
                <th className="pb-1">Strategy</th><th className="pb-1">Win prob used</th>
                <th className="pb-1">Brier</th><th className="pb-1">n</th>
              </tr>
            </thead>
            <tbody>
              {data.sizerInputs.map(s => (
                <tr key={s.strategyKey} className="border-t border-white/5">
                  <td className="py-0.5 text-gray-300">{s.strategyKey}</td>
                  <td className="py-0.5 tabular-nums text-indigo-300">
                    {s.winRate != null ? `${(s.winRate * 100).toFixed(0)}%` : 'maturity floor'}
                  </td>
                  <td className="py-0.5 tabular-nums text-gray-400">{s.brierScore}</td>
                  <td className="py-0.5 tabular-nums text-gray-500">{s.sampleCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
