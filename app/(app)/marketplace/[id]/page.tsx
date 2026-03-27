import { notFound } from 'next/navigation'
import { getListing, getListingReviews, getMySubscriptions } from '@/lib/actions/marketplace'
import { MarketplaceListingClient } from './marketplace-listing-client'

interface Props { params: Promise<{ id: string }> }

export default async function MarketplaceListingPage({ params }: Props) {
  const { id } = await params
  const [listing, reviews, subscriptions] = await Promise.all([
    getListing(id),
    getListingReviews(id),
    getMySubscriptions(),
  ])
  if (!listing) notFound()
  const mySub = subscriptions.find(s => s.listing_id === id)
  return <MarketplaceListingClient listing={listing} reviews={reviews} mySub={mySub ?? null} />
}
