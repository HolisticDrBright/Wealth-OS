'use client'

import { useState, useTransition } from 'react'
import { subscribeListing, cancelSubscription } from '@/lib/actions/marketplace'
import type { MarketplaceListing, MarketplaceSubscription } from '@/lib/types'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { Store, Star, Users, TrendingUp, TrendingDown, Shield, CheckCircle, Plus } from 'lucide-react'

interface Props {
  initialListings: MarketplaceListing[]
  initialSubscriptions: MarketplaceSubscription[]
}

const SORT_OPTIONS = [
  { value: 'subscribers', label: 'Most Followed' },
  { value: 'return', label: 'Best Return' },
  { value: 'rating', label: 'Top Rated' },
  { value: 'newest', label: 'Newest' },
]

const ASSET_CLASSES = ['all', 'stock', 'crypto', 'forex', 'polymarket']

export function MarketplaceClient({ initialListings, initialSubscriptions }: Props) {
  const [listings] = useState(initialListings)
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions)
  const [sort, setSort] = useState('subscribers')
  const [assetFilter, setAssetFilter] = useState('all')
  const [showFreeOnly, setShowFreeOnly] = useState(false)
  const [pending, startTransition] = useTransition()
  const [subscribingId, setSubscribingId] = useState<string | null>(null)

  const subscribedIds = new Set(subscriptions.map(s => s.listing_id))

  const filtered = listings.filter(l => {
    if (assetFilter !== 'all' && !l.asset_classes.includes(assetFilter)) return false
    if (showFreeOnly && l.price_monthly_usd > 0) return false
    return true
  })

  function handleSubscribe(listingId: string) {
    setSubscribingId(listingId)
    startTransition(async () => {
      const sub = await subscribeListing(listingId)
      if (sub) setSubscriptions(prev => [...prev, sub])
      setSubscribingId(null)
    })
  }

  function handleCancel(sub: MarketplaceSubscription) {
    startTransition(async () => {
      await cancelSubscription(sub.id)
      setSubscriptions(prev => prev.filter(s => s.id !== sub.id))
    })
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Strategy Marketplace</h1>
          <p className="text-sm text-gray-400 mt-1">
            {filtered.length} strategies · {subscriptions.length} subscribed
          </p>
        </div>
        <Link
          href="/marketplace/publish"
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Publish Strategy
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {ASSET_CLASSES.map(ac => (
          <button
            key={ac}
            onClick={() => setAssetFilter(ac)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all',
              assetFilter === ac
                ? 'bg-indigo-600 text-white'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
            )}
          >
            {ac === 'all' ? 'All Classes' : ac}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showFreeOnly}
              onChange={e => setShowFreeOnly(e.target.checked)}
              className="rounded"
            />
            Free only
          </label>
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            className="rounded-lg border border-white/10 bg-[#0a0b0f] px-3 py-1.5 text-sm text-white focus:outline-none"
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Listing grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <Store className="h-10 w-10 mb-3 opacity-30" />
          <p>No strategies match your filters</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(listing => {
            const isSubscribed = subscribedIds.has(listing.id)
            const mySub = subscriptions.find(s => s.listing_id === listing.id)
            return (
              <div key={listing.id} className="rounded-xl border border-white/10 bg-white/5 p-5 flex flex-col gap-4 hover:border-white/20 transition-colors">
                {/* Title row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Link href={`/marketplace/${listing.id}`} className="font-semibold text-white hover:text-indigo-400 transition-colors truncate">
                        {listing.title}
                      </Link>
                      {listing.is_verified && (
                        <span title="Verified"><Shield className="h-4 w-4 text-blue-400 shrink-0" /></span>
                      )}
                    </div>
                    {listing.description && (
                      <p className="text-xs text-gray-400 line-clamp-2">{listing.description}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    {listing.is_free ? (
                      <span className="text-xs font-medium text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">Free</span>
                    ) : (
                      <span className="text-xs font-medium text-white">${listing.price_monthly_usd}/mo</span>
                    )}
                  </div>
                </div>

                {/* Asset classes */}
                <div className="flex flex-wrap gap-1.5">
                  {listing.asset_classes.map(ac => (
                    <span key={ac} className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 capitalize">{ac}</span>
                  ))}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-black/20 p-2.5">
                    <p className="text-xs text-gray-500 mb-0.5">Total Return</p>
                    {listing.total_return_pct != null ? (
                      <p className={cn('text-sm font-bold', listing.total_return_pct >= 0 ? 'text-green-400' : 'text-red-400')}>
                        {listing.total_return_pct >= 0 ? '+' : ''}{listing.total_return_pct.toFixed(1)}%
                      </p>
                    ) : <p className="text-sm text-gray-500">—</p>}
                  </div>
                  <div className="rounded-lg bg-black/20 p-2.5">
                    <p className="text-xs text-gray-500 mb-0.5">Sharpe</p>
                    <p className="text-sm font-bold text-white">{listing.sharpe_ratio?.toFixed(2) ?? '—'}</p>
                  </div>
                  <div className="rounded-lg bg-black/20 p-2.5">
                    <p className="text-xs text-gray-500 mb-0.5">Max DD</p>
                    {listing.max_drawdown_pct != null ? (
                      <p className="text-sm font-bold text-red-400">-{listing.max_drawdown_pct.toFixed(1)}%</p>
                    ) : <p className="text-sm text-gray-500">—</p>}
                  </div>
                  <div className="rounded-lg bg-black/20 p-2.5">
                    <p className="text-xs text-gray-500 mb-0.5">Win Rate</p>
                    <p className="text-sm font-bold text-white">{listing.win_rate_pct?.toFixed(1) ?? '—'}%</p>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-1 border-t border-white/5">
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {listing.subscriber_count.toLocaleString()}
                    </span>
                    {listing.avg_rating && (
                      <span className="flex items-center gap-1">
                        <Star className="h-3 w-3 text-yellow-400 fill-yellow-400" />
                        {listing.avg_rating.toFixed(1)}
                        <span className="text-gray-600">({listing.review_count})</span>
                      </span>
                    )}
                  </div>
                  {isSubscribed ? (
                    <button
                      onClick={() => mySub && handleCancel(mySub)}
                      disabled={pending}
                      className="text-xs text-gray-400 hover:text-red-400 transition-colors"
                    >
                      Unsubscribe
                    </button>
                  ) : (
                    <button
                      onClick={() => handleSubscribe(listing.id)}
                      disabled={pending || subscribingId === listing.id}
                      className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                    >
                      <CheckCircle className="h-3.5 w-3.5" />
                      Subscribe
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
