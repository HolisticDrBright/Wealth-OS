'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { MarketplaceListing, MarketplaceSubscription, MarketplaceReview } from '@/lib/types'

export async function getListings(filters?: {
  asset_class?: string
  is_free?: boolean
  sort?: 'subscribers' | 'return' | 'rating' | 'newest'
}): Promise<MarketplaceListing[]> {
  const supabase = await createClient()

  let query = supabase
    .from('marketplace_listings')
    .select('*')
    .eq('is_published', true)

  if (filters?.asset_class) {
    query = query.contains('asset_classes', [filters.asset_class])
  }
  if (filters?.is_free === true) {
    query = query.eq('price_monthly_usd', 0)
  }

  const sortMap = {
    subscribers: 'subscriber_count',
    return: 'total_return_pct',
    rating: 'avg_rating',
    newest: 'created_at',
  }
  const sortCol = sortMap[filters?.sort ?? 'subscribers'] ?? 'subscriber_count'
  query = query.order(sortCol, { ascending: false })

  const { data } = await query.limit(50)
  return data ?? []
}

export async function getListing(id: string): Promise<MarketplaceListing | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('marketplace_listings')
    .select('*')
    .eq('id', id)
    .single()
  return data
}

export async function getMyListings(): Promise<MarketplaceListing[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('marketplace_listings')
    .select('*')
    .eq('publisher_user_id', user.id)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function createListing(payload: {
  title: string
  description?: string
  strategy_type?: string
  asset_classes?: string[]
  price_monthly_usd?: number
  trader_id?: string
}): Promise<MarketplaceListing | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('marketplace_listings')
    .insert({
      publisher_user_id: user.id,
      is_published: false,
      ...payload,
      asset_classes: payload.asset_classes ?? [],
      price_monthly_usd: payload.price_monthly_usd ?? 0,
    })
    .select()
    .single()

  revalidatePath('/marketplace')
  return data
}

export async function updateListing(
  id: string,
  payload: Partial<Pick<MarketplaceListing, 'title' | 'description' | 'is_published' | 'price_monthly_usd' | 'asset_classes'>>
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('marketplace_listings')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('publisher_user_id', user.id)

  revalidatePath('/marketplace')
}

export async function getMySubscriptions(): Promise<MarketplaceSubscription[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('marketplace_subscriptions')
    .select('*, listing:marketplace_listings(*)')
    .eq('user_id', user.id)
    .neq('status', 'cancelled')
    .order('subscribed_at', { ascending: false })

  return data ?? []
}

export async function subscribeListing(
  listingId: string,
  options?: { max_allocation_pct?: number; risk_level?: MarketplaceSubscription['risk_level'] }
): Promise<MarketplaceSubscription | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('marketplace_subscriptions')
    .upsert({
      user_id: user.id,
      listing_id: listingId,
      status: 'active',
      auto_copy_enabled: true,
      max_allocation_pct: options?.max_allocation_pct ?? 5,
      risk_level: options?.risk_level ?? 'moderate',
      subscribed_at: new Date().toISOString(),
    })
    .select()
    .single()

  // Increment subscriber count
  await supabase.rpc('increment_subscriber_count' as never, { listing_id: listingId }).maybeSingle()

  revalidatePath('/marketplace')
  return data
}

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('marketplace_subscriptions')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', subscriptionId)
    .eq('user_id', user.id)

  revalidatePath('/marketplace')
}

export async function getListingReviews(listingId: string): Promise<MarketplaceReview[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('marketplace_reviews')
    .select('*')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: false })
    .limit(20)

  return data ?? []
}

export async function submitReview(
  listingId: string,
  payload: { rating: number; title?: string; body?: string }
): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  // Check if verified subscriber
  const { data: sub } = await supabase
    .from('marketplace_subscriptions')
    .select('id')
    .eq('user_id', user.id)
    .eq('listing_id', listingId)
    .single()

  await supabase
    .from('marketplace_reviews')
    .upsert({
      listing_id: listingId,
      reviewer_user_id: user.id,
      rating: payload.rating,
      title: payload.title,
      body: payload.body,
      is_verified_subscriber: !!sub,
    })

  revalidatePath(`/marketplace/${listingId}`)
}
