'use client'

/**
 * AiCostChart — interactive Recharts visualization for AI feature spend.
 *
 * Renders:
 *   - Line chart of daily cost per feature (last 30 days)
 *   - Stacked area for cumulative monthly spend per feature
 *
 * Props drive both views; parent supplies daily breakdown data.
 */

import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DailyFeatureCost {
  date: string              // 'MMM D', e.g. 'Apr 1'
  [featureKey: string]: string | number
}

export interface AiCostChartProps {
  /** Daily data points — one per calendar day, each key is a feature. */
  dailyData: DailyFeatureCost[]
  /** Cumulative running-total data (same shape as dailyData). */
  cumulativeData: DailyFeatureCost[]
  /** Feature keys to plot — determines which series appear. */
  featureKeys: string[]
  /** Map of featureKey → display label. */
  labels?: Record<string, string>
  /** Chart height in pixels (default 160). */
  height?: number
  /** Which chart variant to show. */
  variant?: 'daily' | 'cumulative'
}

// Violet colour palette — one per feature, wraps after 6
const PALETTE = [
  '#8b5cf6', '#6366f1', '#ec4899', '#10b981',
  '#f59e0b', '#06b6d4',
]

const tooltipStyle = {
  background: '#1a1b23',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  fontSize: 12,
  color: '#e5e7eb',
}

function formatTick(v: number) {
  return v === 0 ? '$0' : `$${v.toFixed(2)}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AiCostChart({
  dailyData,
  cumulativeData,
  featureKeys,
  labels = {},
  height = 160,
  variant = 'cumulative',
}: AiCostChartProps) {
  const data = variant === 'cumulative' ? cumulativeData : dailyData

  if (!data.length || !featureKeys.length) {
    return (
      <div
        className="flex items-center justify-center text-xs text-gray-600 rounded-lg border border-white/5"
        style={{ height }}
      >
        No spend data yet
      </div>
    )
  }

  if (variant === 'cumulative') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 9, fill: '#6b7280' }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#6b7280' }}
            tickLine={false}
            tickFormatter={formatTick}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value, name) => [
              `$${Number(value).toFixed(2)}`,
              labels[name as string] ?? name,
            ]}
          />
          <Legend
            iconType="circle"
            iconSize={6}
            wrapperStyle={{ fontSize: 10, color: '#9ca3af' }}
            formatter={name => labels[name] ?? name}
          />
          {featureKeys.map((key, i) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              stackId="1"
              stroke={PALETTE[i % PALETTE.length]}
              fill={PALETTE[i % PALETTE.length]}
              fillOpacity={0.25}
              strokeWidth={1.5}
              dot={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    )
  }

  // Daily line chart
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 9, fill: '#6b7280' }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 9, fill: '#6b7280' }}
          tickLine={false}
          tickFormatter={formatTick}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) => [
            `$${Number(value).toFixed(2)}`,
            labels[name as string] ?? name,
          ]}
        />
        <Legend
          iconType="circle"
          iconSize={6}
          wrapperStyle={{ fontSize: 10, color: '#9ca3af' }}
          formatter={name => labels[name] ?? name}
        />
        {featureKeys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={PALETTE[i % PALETTE.length]}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── Data builder helpers ─────────────────────────────────────────────────────

/**
 * Build dailyData and cumulativeData from raw usage logs.
 * Exported so the parent page can call this server-side and pass props.
 */
export function buildChartData(
  logs: Array<{ created_at: string; cost_usd: number; feature_key: string }>,
  featureKeys: string[],
  days = 30
): { dailyData: DailyFeatureCost[]; cumulativeData: DailyFeatureCost[] } {
  const now = new Date()
  const dateList: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    dateList.push(d.toISOString().slice(0, 10))
  }

  // Accumulate spend per day per feature
  const byDayFeature = new Map<string, Map<string, number>>()
  for (const log of logs) {
    const day = log.created_at.slice(0, 10)
    if (!byDayFeature.has(day)) byDayFeature.set(day, new Map())
    const m = byDayFeature.get(day)!
    m.set(log.feature_key, (m.get(log.feature_key) ?? 0) + log.cost_usd)
  }

  const dailyData: DailyFeatureCost[] = []
  const cumulativeData: DailyFeatureCost[] = []
  const running = new Map<string, number>(featureKeys.map(k => [k, 0]))

  for (const iso of dateList) {
    const label = new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const dayRow: DailyFeatureCost = { date: label }
    const cumRow: DailyFeatureCost = { date: label }

    for (const key of featureKeys) {
      const spend = byDayFeature.get(iso)?.get(key) ?? 0
      dayRow[key] = Math.round(spend * 100) / 100
      running.set(key, (running.get(key) ?? 0) + spend)
      cumRow[key] = Math.round((running.get(key) ?? 0) * 100) / 100
    }

    dailyData.push(dayRow)
    cumulativeData.push(cumRow)
  }

  return { dailyData, cumulativeData }
}
