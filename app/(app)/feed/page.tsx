import { createClient } from '@/lib/supabase/server'
import { FeedClient } from './feed-client'

export default async function FeedPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  // Get followed trader IDs
  const { data: followed } = await supabase
    .from('user_followed_traders')
    .select('trader_id')
    .eq('user_id', user.id)

  const traderIds = (followed ?? []).map((f: { trader_id: string }) => f.trader_id)

  // Fetch initial feed
  let initialTrades: unknown[] = []
  if (traderIds.length > 0) {
    const { data } = await supabase
      .from('trader_trades')
      .select(`
        id, trader_id, asset_class, symbol, action,
        quantity, price, notional_value, trade_date, metadata,
        traders(id, name, handle, asset_class, avatar_url)
      `)
      .in('trader_id', traderIds)
      .order('trade_date', { ascending: false })
      .limit(50)

    initialTrades = data ?? []
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Live Feed</h1>
        <p className="text-sm text-gray-500 mt-1">Real-time trades from the traders you follow</p>
      </div>
      <FeedClient
        initialTrades={initialTrades}
        followedTraderIds={traderIds}
        userId={user.id}
        hasFollows={traderIds.length > 0}
      />
    </div>
  )
}
