'use client'

import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import { MarketCard } from './market-card'
import type { Market } from '@/lib/meta-poly/types'

type SortKey = 'liquidity' | 'volume' | 'entropy' | 'arb'

interface Props {
  initialMarkets: Market[]
}

export function MarketsTab({ initialMarkets }: Props) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState<SortKey>('liquidity')

  const categories = useMemo(() => {
    const cats = new Set(initialMarkets.map(m => m.category).filter(Boolean))
    return ['all', ...Array.from(cats).sort()]
  }, [initialMarkets])

  const filtered = useMemo(() => {
    let list = initialMarkets
    if (query) {
      const q = query.toLowerCase()
      list = list.filter(
        m =>
          m.question.toLowerCase().includes(q) ||
          m.category.toLowerCase().includes(q)
      )
    }
    if (category !== 'all') {
      list = list.filter(m => m.category === category)
    }
    return [...list].sort((a, b) => {
      if (sort === 'liquidity') return b.liquidity - a.liquidity
      if (sort === 'volume') return b.volume_24h - a.volume_24h
      if (sort === 'entropy') return b.entropy_bits - a.entropy_bits
      if (sort === 'arb') return b.arb_edge - a.arb_edge
      return 0
    })
  }, [initialMarkets, query, category, sort])

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search markets…"
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-white/20"
          />
        </div>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="rounded-lg border border-white/10 bg-[#0a0b0f] px-3 py-2 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-white/20"
        >
          {categories.map(c => (
            <option key={c} value={c}>
              {c === 'all' ? 'All categories' : c}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortKey)}
          className="rounded-lg border border-white/10 bg-[#0a0b0f] px-3 py-2 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-white/20"
        >
          <option value="liquidity">Sort: Liquidity</option>
          <option value="volume">Sort: Volume</option>
          <option value="entropy">Sort: Entropy</option>
          <option value="arb">Sort: Arb edge</option>
        </select>
      </div>

      <p className="text-xs text-gray-500">{filtered.length} markets</p>

      {filtered.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border border-white/10 bg-white/5 py-20">
          <p className="text-sm text-gray-400">No markets match your filters</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map(market => (
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      )}
    </div>
  )
}
