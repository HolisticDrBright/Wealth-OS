import { MarketplaceClient } from './marketplace-client'
import { getListings, getMySubscriptions } from '@/lib/actions/marketplace'

export default async function MarketplacePage() {
  const [listings, subscriptions] = await Promise.all([
    getListings(),
    getMySubscriptions(),
  ])
  return <MarketplaceClient initialListings={listings} initialSubscriptions={subscriptions} />
}
