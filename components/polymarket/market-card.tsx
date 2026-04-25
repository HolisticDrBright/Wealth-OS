'use client'

import Link from 'next/link'
import { Droplets, TrendingUp, Zap, Calendar, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Market } from '@/lib/meta-poly/types'

interface Props {
  market: Market
  className?: string
}

export function MarketCard({ market, className }: Props) {
  const { yes_price, no_price, arb_edge, end_date, entropy_bits } = market
  const hasArb = arb_edge > 0.005
  const endDate = end_date ? new Date(end_date) : null
  const isExpiringSoon =
    endDate !== null &&
    endDate.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000

  return (
    <Link href={`/polymarket/${encodeURIComponent(market.condition_id)}`}>
      <div
        className={cn(
          'group flex cursor-pointer flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4 transition-all hover:border-white/20 hover:bg-white/[0.08]',
          className
        )}
      >
        {/* Question + arb badge */}
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-sm font-medium leading-snug text-white">
            {market.question}
          </p>
          {hasArb && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              ARB
            </span>
          )}
        </div>

        {/* Category */}
        <span className="w-fit rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-400">
          {market.category}
        </span>

        {/* YES / NO price bars */}
        <div className="space-y-1.5">
          <PriceRow side="YES" price={yes_price} color="green" />
          <PriceRow side="NO" price={no_price} color="red" />
        </div>

        {/* Footer stats */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Droplets className="h-3 w-3" />
            ${formatK(market.liquidity)}
          </span>
          <span className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            ${formatK(market.volume_24h)}
          </span>
          {entropy_bits > 0 && (
            <span className="flex items-center gap-1 text-accent-cyan">
              <Zap className="h-3 w-3" />
              {entropy_bits.toFixed(2)} bits
            </span>
          )}
          {endDate && (
            <span
              className={cn(
                'ml-auto flex items-center gap-1',
                isExpiringSoon && 'text-amber-400'
              )}
            >
              <Calendar className="h-3 w-3" />
              {endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

function PriceRow({
  side,
  price,
  color,
}: {
  side: 'YES' | 'NO'
  price: number
  color: 'green' | 'red'
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'w-7 text-xs font-medium',
          color === 'green' ? 'text-green-400' : 'text-red-400'
        )}
      >
        {side}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            color === 'green' ? 'bg-green-500' : 'bg-red-500'
          )}
          style={{ width: `${Math.min(price * 100, 100)}%` }}
        />
      </div>
      <span className="w-10 text-right font-mono text-xs text-white">
        {(price * 100).toFixed(1)}¢
      </span>
    </div>
  )
}

function formatK(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`
  return value.toFixed(0)
}
