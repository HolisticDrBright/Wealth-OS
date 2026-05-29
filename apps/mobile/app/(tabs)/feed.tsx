import { useEffect, useState } from 'react'
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { supabase, apiFetch } from '@/lib/supabase'
import type { TraderTrade } from '@/src/types'

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const ACTION_COLOR: Record<string, string> = {
  buy: '#10b981', sell: '#ef4444', short: '#f97316', cover: '#6366f1',
}

export default function FeedScreen() {
  const [trades, setTrades] = useState<TraderTrade[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [followedIds, setFollowedIds] = useState<string[]>([])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Get followed trader IDs
    const { data: followed } = await supabase
      .from('user_followed_traders')
      .select('trader_id')
      .eq('user_id', user.id)

    const ids = (followed ?? []).map((f: { trader_id: string }) => f.trader_id)
    setFollowedIds(ids)

    if (ids.length === 0) {
      setLoading(false)
      setRefreshing(false)
      return
    }

    const { data } = await supabase
      .from('trader_trades')
      .select('*, traders(name, handle)')
      .in('trader_id', ids)
      .order('trade_date', { ascending: false })
      .limit(50)

    setTrades(data ?? [])
    setLoading(false)
    setRefreshing(false)
  }

  // Realtime subscription
  useEffect(() => {
    // Wrap in an async IIFE so the setState calls inside load() happen after an
    // await (post-mount) rather than synchronously in the effect body. load() is
    // still invoked synchronously, so fetch timing is unchanged.
    void (async () => { await load() })()

    const channel = supabase
      .channel('mobile-feed-updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trader_trades' }, async (payload) => {
        const trade = payload.new as TraderTrade
        if (!followedIds.includes(trade.trader_id)) return

        const { data: trader } = await supabase
          .from('traders')
          .select('name, handle')
          .eq('id', trade.trader_id)
          .single()

        setTrades(prev => [{ ...trade, traders: trader ?? undefined }, ...prev].slice(0, 100))
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [followedIds.join(',')])

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#6366f1" size="large" /></View>
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Live Feed</Text>
        <Text style={styles.subtitle}>Real-time trades from followed traders</Text>
      </View>

      {trades.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No trades yet</Text>
          <Text style={styles.emptySubText}>Follow traders on the web app to see their activity here</Text>
        </View>
      ) : (
        <FlatList
          data={trades}
          keyExtractor={t => t.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load() }} tintColor="#6366f1" />}
          renderItem={({ item }) => (
            <View style={styles.tradeCard}>
              <View style={styles.tradeAvatar}>
                <Text style={styles.tradeAvatarText}>{(item.traders?.name ?? '?')[0]}</Text>
              </View>
              <View style={styles.tradeBody}>
                <View style={styles.tradeTop}>
                  <Text style={styles.traderName}>{item.traders?.name ?? 'Unknown'}</Text>
                  <Text style={[styles.actionBadge, { color: ACTION_COLOR[item.action] ?? '#fff' }]}>
                    {item.action.toUpperCase()}
                  </Text>
                  <Text style={styles.symbol}>{item.symbol}</Text>
                </View>
                <View style={styles.tradeBottom}>
                  {item.notional_value && (
                    <Text style={styles.tradeMeta}>${item.notional_value.toLocaleString()}</Text>
                  )}
                  <Text style={styles.tradeMeta}>{item.asset_class}</Text>
                  <Text style={styles.tradeTime}>{timeAgo(item.trade_date)}</Text>
                </View>
              </View>
            </View>
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0b0f' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16 },
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  subtitle: { color: '#6b7280', fontSize: 13, marginTop: 2 },
  list: { padding: 16 },
  emptyText: { color: '#9ca3af', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  emptySubText: { color: '#6b7280', fontSize: 13, textAlign: 'center', marginTop: 8 },
  tradeCard: { flexDirection: 'row', gap: 12, backgroundColor: '#0f1117', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  tradeAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(99,102,241,0.2)', justifyContent: 'center', alignItems: 'center' },
  tradeAvatarText: { color: '#818cf8', fontSize: 16, fontWeight: 'bold' },
  tradeBody: { flex: 1 },
  tradeTop: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  traderName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  actionBadge: { fontSize: 11, fontWeight: '700' },
  symbol: { color: '#818cf8', fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  tradeBottom: { flexDirection: 'row', gap: 10, marginTop: 4 },
  tradeMeta: { color: '#6b7280', fontSize: 12 },
  tradeTime: { color: '#4b5563', fontSize: 12, marginLeft: 'auto' },
})
