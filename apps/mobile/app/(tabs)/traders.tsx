import { useEffect, useState } from 'react'
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  TouchableOpacity, RefreshControl,
} from 'react-native'
import { supabase } from '@/lib/supabase'
import type { Trader } from '@/src/types'

export default function TradersScreen() {
  const [traders, setTraders] = useState<Trader[]>([])
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [tradersRes, followedRes] = await Promise.all([
      supabase.from('traders').select('*').eq('is_active', true).order('total_return_pct', { ascending: false }).limit(30),
      supabase.from('user_followed_traders').select('trader_id').eq('user_id', user.id),
    ])

    setTraders(tradersRes.data ?? [])
    setFollowedIds(new Set((followedRes.data ?? []).map((f: { trader_id: string }) => f.trader_id)))
    setLoading(false)
    setRefreshing(false)
  }

  // Wrap in an async IIFE so the setState calls inside load() happen after an
  // await (post-mount) rather than synchronously in the effect body. load() is
  // still invoked synchronously, so fetch timing is unchanged.
  useEffect(() => { void (async () => { await load() })() }, [])

  async function toggleFollow(trader: Trader) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || toggling) return

    setToggling(trader.id)
    const isFollowed = followedIds.has(trader.id)

    if (isFollowed) {
      await supabase.from('user_followed_traders').delete().eq('user_id', user.id).eq('trader_id', trader.id)
      setFollowedIds(prev => { const s = new Set(prev); s.delete(trader.id); return s })
    } else {
      await supabase.from('user_followed_traders').insert({
        user_id: user.id,
        trader_id: trader.id,
        auto_copy_enabled: false,
        max_allocation_pct_per_trade: 5,
        risk_level: 'moderate',
        copy_asset_classes: [trader.asset_class],
      })
      setFollowedIds(prev => new Set([...prev, trader.id]))
    }
    setToggling(null)
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#6366f1" size="large" /></View>
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Top Traders</Text>
        <Text style={styles.subtitle}>Follow to see their trades in your feed</Text>
      </View>
      <FlatList
        data={traders}
        keyExtractor={t => t.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load() }} tintColor="#6366f1" />}
        renderItem={({ item }) => {
          const followed = followedIds.has(item.id)
          return (
            <View style={styles.traderCard}>
              <View style={styles.traderAvatar}>
                <Text style={styles.traderAvatarText}>{item.name[0]}</Text>
              </View>
              <View style={styles.traderInfo}>
                <View style={styles.traderRow}>
                  <Text style={styles.traderName}>{item.name}</Text>
                  {item.verified && <Text style={styles.verifiedBadge}>✓</Text>}
                </View>
                <Text style={styles.traderHandle}>@{item.handle}</Text>
                <View style={styles.traderStats}>
                  <Text style={[styles.returnPct, { color: item.total_return_pct >= 0 ? '#10b981' : '#ef4444' }]}>
                    {item.total_return_pct >= 0 ? '+' : ''}{item.total_return_pct.toFixed(1)}%
                  </Text>
                  <Text style={styles.statSep}>·</Text>
                  <Text style={styles.winRate}>{item.win_rate_pct}% win rate</Text>
                  <Text style={styles.statSep}>·</Text>
                  <Text style={styles.assetClass}>{item.asset_class}</Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.followBtn, followed && styles.followBtnActive]}
                onPress={() => toggleFollow(item)}
                disabled={toggling === item.id}
              >
                <Text style={[styles.followBtnText, followed && styles.followBtnTextActive]}>
                  {toggling === item.id ? '...' : followed ? 'Following' : 'Follow'}
                </Text>
              </TouchableOpacity>
            </View>
          )
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0b0f' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16 },
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  subtitle: { color: '#6b7280', fontSize: 13, marginTop: 2 },
  list: { padding: 16 },
  traderCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#0f1117', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  traderAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(99,102,241,0.2)', justifyContent: 'center', alignItems: 'center' },
  traderAvatarText: { color: '#818cf8', fontSize: 18, fontWeight: 'bold' },
  traderInfo: { flex: 1 },
  traderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  traderName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  verifiedBadge: { color: '#6366f1', fontSize: 12 },
  traderHandle: { color: '#6b7280', fontSize: 12, marginTop: 1 },
  traderStats: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  returnPct: { fontSize: 12, fontWeight: '700' },
  winRate: { color: '#9ca3af', fontSize: 12 },
  assetClass: { color: '#6b7280', fontSize: 11, textTransform: 'capitalize' },
  statSep: { color: '#374151', fontSize: 12 },
  followBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(99,102,241,0.5)' },
  followBtnActive: { backgroundColor: 'rgba(99,102,241,0.2)', borderColor: '#6366f1' },
  followBtnText: { color: '#818cf8', fontSize: 12, fontWeight: '600' },
  followBtnTextActive: { color: '#6366f1' },
})
