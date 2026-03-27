'use client'

import { useState, useTransition } from 'react'
import { subscribeListing, cancelSubscription, submitReview } from '@/lib/actions/marketplace'
import type { MarketplaceListing, MarketplaceSubscription, MarketplaceReview } from '@/lib/types'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { ArrowLeft, Star, Users, Shield, CheckCircle, TrendingUp, TrendingDown } from 'lucide-react'

interface Props {
  listing: MarketplaceListing
  reviews: MarketplaceReview[]
  mySub: MarketplaceSubscription | null
}

export function MarketplaceListingClient({ listing, reviews: initialReviews, mySub: initialSub }: Props) {
  const [mySub, setMySub] = useState(initialSub)
  const [reviews, setReviews] = useState(initialReviews)
  const [pending, startTransition] = useTransition()

  // Review form state
  const [rating, setRating] = useState(5)
  const [reviewTitle, setReviewTitle] = useState('')
  const [reviewBody, setReviewBody] = useState('')
  const [showReviewForm, setShowReviewForm] = useState(false)

  function handleSubscribe() {
    startTransition(async () => {
      const sub = await subscribeListing(listing.id)
      if (sub) setMySub(sub)
    })
  }

  function handleCancel() {
    if (!mySub) return
    startTransition(async () => {
      await cancelSubscription(mySub.id)
      setMySub(null)
    })
  }

  function handleReview() {
    startTransition(async () => {
      await submitReview(listing.id, { rating, title: reviewTitle, body: reviewBody })
      setShowReviewForm(false)
      setReviewTitle('')
      setReviewBody('')
      // Optimistically add
      setReviews(prev => [{
        id: 'temp',
        listing_id: listing.id,
        reviewer_user_id: 'me',
        rating,
        title: reviewTitle,
        body: reviewBody,
        is_verified_subscriber: !!mySub,
        helpful_votes: 0,
        created_at: new Date().toISOString(),
      }, ...prev.filter(r => r.reviewer_user_id !== 'me')])
    })
  }

  const stats = [
    { label: 'Total Return', value: listing.total_return_pct != null ? `${listing.total_return_pct >= 0 ? '+' : ''}${listing.total_return_pct.toFixed(2)}%` : '—', color: (listing.total_return_pct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400' },
    { label: 'YTD Return', value: listing.ytd_return_pct != null ? `${listing.ytd_return_pct >= 0 ? '+' : ''}${listing.ytd_return_pct.toFixed(2)}%` : '—', color: (listing.ytd_return_pct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400' },
    { label: 'Sharpe Ratio', value: listing.sharpe_ratio?.toFixed(2) ?? '—', color: 'text-white' },
    { label: 'Max Drawdown', value: listing.max_drawdown_pct != null ? `-${listing.max_drawdown_pct.toFixed(2)}%` : '—', color: 'text-red-400' },
    { label: 'Win Rate', value: listing.win_rate_pct != null ? `${listing.win_rate_pct.toFixed(1)}%` : '—', color: 'text-white' },
    { label: 'Total Trades', value: listing.trade_count.toLocaleString(), color: 'text-white' },
  ]

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl">
      <Link href="/marketplace" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors w-fit">
        <ArrowLeft className="h-4 w-4" />
        Marketplace
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold text-white">{listing.title}</h1>
            {listing.is_verified && (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-medium">
                <Shield className="h-3 w-3" />
                Verified
              </span>
            )}
          </div>
          {listing.description && (
            <p className="text-gray-400 mb-3">{listing.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              {listing.subscriber_count.toLocaleString()} subscribers
            </span>
            {listing.avg_rating && (
              <span className="flex items-center gap-1">
                <Star className="h-4 w-4 text-yellow-400 fill-yellow-400" />
                {listing.avg_rating.toFixed(1)} ({listing.review_count} reviews)
              </span>
            )}
            {listing.inception_date && (
              <span>Since {new Date(listing.inception_date).toLocaleDateString()}</span>
            )}
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-2">
          <p className="text-lg font-bold text-white">
            {listing.is_free ? <span className="text-green-400">Free</span> : `$${listing.price_monthly_usd}/mo`}
          </p>
          {mySub ? (
            <div className="flex flex-col items-end gap-2">
              <span className="flex items-center gap-1.5 text-xs text-green-400 font-medium">
                <CheckCircle className="h-3.5 w-3.5" />
                Subscribed
              </span>
              <button
                onClick={handleCancel}
                disabled={pending}
                className="text-xs text-gray-500 hover:text-red-400 transition-colors"
              >
                Cancel subscription
              </button>
            </div>
          ) : (
            <button
              onClick={handleSubscribe}
              disabled={pending}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              Subscribe
            </button>
          )}
        </div>
      </div>

      {/* Asset classes */}
      <div className="flex flex-wrap gap-2">
        {listing.asset_classes.map(ac => (
          <span key={ac} className="text-xs px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 capitalize">{ac}</span>
        ))}
        {listing.strategy_type && (
          <span className="text-xs px-3 py-1 rounded-full bg-white/10 text-gray-300 capitalize">{listing.strategy_type.replace('_', ' ')}</span>
        )}
      </div>

      {/* Performance stats */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Performance</h2>
        <div className="grid grid-cols-3 gap-3">
          {stats.map(s => (
            <div key={s.label} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs text-gray-500 mb-1">{s.label}</p>
              <p className={cn('text-xl font-bold', s.color)}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Reviews */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Reviews ({reviews.length})
          </h2>
          {mySub && !showReviewForm && (
            <button
              onClick={() => setShowReviewForm(true)}
              className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              Write a review
            </button>
          )}
        </div>

        {showReviewForm && (
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4 flex flex-col gap-3 mb-4">
            <div className="flex items-center gap-2">
              {[1,2,3,4,5].map(n => (
                <button
                  key={n}
                  onClick={() => setRating(n)}
                  className={cn('text-xl transition-colors', n <= rating ? 'text-yellow-400' : 'text-gray-600')}
                >
                  ★
                </button>
              ))}
            </div>
            <input
              value={reviewTitle}
              onChange={e => setReviewTitle(e.target.value)}
              placeholder="Review title"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
            <textarea
              value={reviewBody}
              onChange={e => setReviewBody(e.target.value)}
              placeholder="Share your experience..."
              rows={3}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleReview}
                disabled={pending}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                Submit
              </button>
              <button
                onClick={() => setShowReviewForm(false)}
                className="px-4 py-2 rounded-lg bg-white/5 text-sm text-gray-300 hover:bg-white/10"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {reviews.length === 0 ? (
          <p className="text-sm text-gray-500">No reviews yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {reviews.map(r => (
              <div key={r.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-yellow-400">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                      {r.is_verified_subscriber && (
                        <span className="text-xs text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded">Verified</span>
                      )}
                    </div>
                    {r.title && <p className="font-medium text-white mt-1">{r.title}</p>}
                  </div>
                  <p className="text-xs text-gray-500">{new Date(r.created_at).toLocaleDateString()}</p>
                </div>
                {r.body && <p className="text-sm text-gray-400">{r.body}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
