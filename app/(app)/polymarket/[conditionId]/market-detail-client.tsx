'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { ArrowLeft, Droplets, TrendingUp, Zap, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Topbar } from '@/components/layout/topbar'
import { createMetaPolyWS, metaPolyWsUrl } from '@/lib/meta-poly/ws'
import type { Market } from '@/lib/meta-poly/types'

interface PricePoint {
  t: string
  yes: number
  no: number
}

interface Props {
  market: Market
}

export function MarketDetailClient({ market: initial }: Props) {
  const [market, setMarket] = useState(initial)
  const [history, setHistory] = useState<PricePoint[]>([
    {
      t: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      yes: initial.yes_price * 100,
      no: initial.no_price * 100,
    },
  ])

  useEffect(() => {
    const ws = createMetaPolyWS(metaPolyWsUrl(), {
      price_update: data => {
        if (data.market_id !== market.id) return
        setMarket(m => ({ ...m, yes_price: data.yes_price, no_price: data.no_price }))
        setHistory(h => {
          const t = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
          return [...h, { t, yes: data.yes_price * 100, no: data.no_price * 100 }].slice(-60)
        })
      },
    })
    return () => ws.close()
  }, [market.id])

  const hasArb = market.arb_edge > 0.005
  const endDate = market.end_date ? new Date(market.end_date) : null

  return (
    <div className="flex flex-col">
      <Topbar title="Market Detail" subtitle="Polymarket" />

      <div className="flex flex-col gap-6 p-6">
        {/* Back */}
        <Link
          href="/polymarket"
          className="flex w-fit items-center gap-1.5 text-sm text-gray-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to markets
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-xs uppercase tracking-wider text-indigo-400">
              {market.category}
            </p>
            <h2 className="text-xl font-bold leading-snug text-white">{market.question}</h2>
            {endDate && (
              <p className="mt-1 text-xs text-gray-500">
                Closes{' '}
                {endDate.toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            )}
          </div>
          {hasArb && (
            <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-500/15 px-3 py-1.5 text-sm font-medium text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              Arb {(market.arb_edge * 100).toFixed(2)}%
            </span>
          )}
        </div>

        {/* Price chart */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="mb-4 text-xs uppercase tracking-wider text-gray-400">Live price</p>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={history}>
              <defs>
                <linearGradient id="yesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="noGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="t"
                tick={{ fill: '#6b7280', fontSize: 10 }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: '#6b7280', fontSize: 10 }}
                tickLine={false}
                unit="¢"
              />
              <Tooltip
                contentStyle={{
                  background: '#0a0b0f',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                }}
                labelStyle={{ color: '#9ca3af', fontSize: 11 }}
                itemStyle={{ fontSize: 12 }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: any) => [`${Number(v).toFixed(1)}¢`]}
              />
              <Area
                type="monotone"
                dataKey="yes"
                stroke="#22c55e"
                strokeWidth={2}
                fill="url(#yesGrad)"
                name="YES"
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="no"
                stroke="#ef4444"
                strokeWidth={2}
                fill="url(#noGrad)"
                name="NO"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'YES price', value: `${(market.yes_price * 100).toFixed(1)}¢`, color: 'text-green-400' },
            { label: 'NO price', value: `${(market.no_price * 100).toFixed(1)}¢`, color: 'text-red-400' },
            { label: 'Spread', value: `${(market.spread * 100).toFixed(2)}¢` },
            {
              label: 'Bid / Ask',
              value: `${(market.best_bid * 100).toFixed(1)} / ${(market.best_ask * 100).toFixed(1)}¢`,
            },
            {
              label: 'Liquidity',
              value: `$${fmtK(market.liquidity)}`,
              icon: <Droplets className="h-3 w-3" />,
            },
            {
              label: '24h volume',
              value: `$${fmtK(market.volume_24h)}`,
              icon: <TrendingUp className="h-3 w-3" />,
            },
            {
              label: 'Entropy',
              value: market.entropy_bits > 0 ? `${market.entropy_bits.toFixed(3)} bits` : '—',
              icon: <Zap className="h-3 w-3" />,
              color: market.entropy_bits > 0 ? 'text-accent-cyan' : undefined,
            },
            {
              label: 'Model prob.',
              value:
                market.model_probability > 0
                  ? `${(market.model_probability * 100).toFixed(1)}%`
                  : '—',
            },
          ].map(({ label, value, color, icon }) => (
            <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="flex items-center gap-1 text-xs text-gray-500">
                {icon}
                {label}
              </p>
              <p className={cn('mt-0.5 text-base font-semibold text-white', color)}>{value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function fmtK(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`
  return value.toFixed(0)
}
