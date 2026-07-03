'use client'

/**
 * Model vs Market fair value (widget 8) — each entry fill plotted as
 * (market price paid, model probability). Above the diagonal = the model saw
 * value the market didn't price; ON the diagonal = no edge. Shows instantly
 * where edge comes from — and when it's gone.
 */

import { Crosshair } from 'lucide-react'
import {
  ResponsiveContainer, ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import type { FairValuePoint } from '@/lib/actions/fair-value'

export function FairValuePanel({ points }: { points: FairValuePoint[] }) {
  const diagonal = [{ marketPrice: 0, modelProb: 0 }, { marketPrice: 1, modelProb: 1 }]

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
        <Crosshair className="h-4 w-4 text-indigo-400" /> Model vs Market
        <span className="text-[10px] font-normal text-gray-600">
          entry fills · above the diagonal = edge the market didn’t price
        </span>
      </h3>
      {points.length === 0 ? (
        <p className="mt-3 text-xs text-gray-500">
          Appears once Polymarket strategies with probability models (info-lag,
          base-rate, 5-min binary) record fills.
        </p>
      ) : (
        <div className="mt-3 h-56" style={{ minHeight: 224 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="marketPrice" type="number" domain={[0, 1]}
                tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false}
                label={{ value: 'market price paid', position: 'insideBottom', fontSize: 10, fill: '#4b5563' }} />
              <YAxis dataKey="modelProb" type="number" domain={[0, 1]}
                tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} width={30} />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                formatter={(v, name) => [Number(v).toFixed(3), name === 'modelProb' ? 'Model P(win)' : 'Market price']}
                labelFormatter={() => ''}
              />
              <Line data={diagonal} dataKey="modelProb" stroke="rgba(255,255,255,0.2)"
                strokeDasharray="4 4" dot={false} isAnimationActive={false} />
              <Scatter data={points} dataKey="modelProb" fill="#34d399" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
