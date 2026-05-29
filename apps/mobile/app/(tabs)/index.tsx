import { useEffect, useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  RefreshControl, TouchableOpacity,
} from 'react-native'
import { supabase } from '@/lib/supabase'
import type { Asset } from '@/src/types'

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

export default function DashboardScreen() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [userName, setUserName] = useState('')

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [assetsRes, profileRes] = await Promise.all([
      supabase.from('assets').select('*').eq('user_id', user.id),
      supabase.from('profiles').select('full_name').eq('id', user.id).single(),
    ])

    setAssets(assetsRes.data ?? [])
    setUserName(profileRes.data?.full_name ?? user.email ?? '')
    setLoading(false)
    setRefreshing(false)
  }

  // Wrap in an async IIFE so the setState calls inside load() happen after an
  // await (post-mount) rather than synchronously in the effect body. load() is
  // still invoked synchronously, so fetch timing is unchanged.
  useEffect(() => { void (async () => { await load() })() }, [])

  const totalAssets = assets.reduce((s, a) => s + a.current_value, 0)
  const byCategory = assets.reduce((acc, a) => {
    acc[a.category] = (acc[a.category] ?? 0) + a.current_value
    return acc
  }, {} as Record<string, number>)

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6366f1" size="large" />
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load() }} tintColor="#6366f1" />}
    >
      <View style={styles.header}>
        <Text style={styles.greeting}>Good morning{userName ? `, ${userName.split(' ')[0]}` : ''}</Text>
        <Text style={styles.date}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
      </View>

      {/* Net worth card */}
      <View style={styles.netWorthCard}>
        <Text style={styles.netWorthLabel}>Total Net Worth</Text>
        <Text style={styles.netWorthValue}>{formatCurrency(totalAssets)}</Text>
        <Text style={styles.netWorthSub}>{assets.length} assets tracked</Text>
      </View>

      {/* Category breakdown */}
      {Object.keys(byCategory).length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>By Category</Text>
          {Object.entries(byCategory)
            .sort(([, a], [, b]) => b - a)
            .map(([cat, val]) => (
              <View key={cat} style={styles.categoryRow}>
                <View style={styles.categoryLeft}>
                  <Text style={styles.categoryName}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</Text>
                  <Text style={styles.categoryPct}>
                    {totalAssets > 0 ? ((val / totalAssets) * 100).toFixed(1) : 0}%
                  </Text>
                </View>
                <Text style={styles.categoryValue}>{formatCurrency(val)}</Text>
              </View>
            ))}
        </View>
      )}

      {/* Assets list */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Holdings</Text>
        {assets.length === 0 ? (
          <Text style={styles.emptyText}>No assets yet. Add them on the web app.</Text>
        ) : (
          assets.map(asset => (
            <View key={asset.id} style={styles.assetRow}>
              <View style={styles.assetLeft}>
                <Text style={styles.assetName}>{asset.name}</Text>
                {asset.symbol && <Text style={styles.assetSymbol}>{asset.symbol}</Text>}
              </View>
              <Text style={styles.assetValue}>{formatCurrency(asset.current_value)}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0b0f' },
  content: { padding: 20, paddingTop: 60 },
  center: { flex: 1, backgroundColor: '#0a0b0f', justifyContent: 'center', alignItems: 'center' },
  header: { marginBottom: 20 },
  greeting: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  date: { color: '#6b7280', fontSize: 13, marginTop: 2 },
  netWorthCard: { backgroundColor: '#4f46e5', borderRadius: 16, padding: 24, marginBottom: 20 },
  netWorthLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '500' },
  netWorthValue: { color: '#fff', fontSize: 36, fontWeight: 'bold', marginTop: 4 },
  netWorthSub: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 4 },
  section: { backgroundColor: '#0f1117', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  sectionTitle: { color: '#9ca3af', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  categoryLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  categoryName: { color: '#fff', fontSize: 14 },
  categoryPct: { color: '#6b7280', fontSize: 12 },
  categoryValue: { color: '#fff', fontSize: 14, fontWeight: '600' },
  assetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  assetLeft: {},
  assetName: { color: '#fff', fontSize: 14, fontWeight: '500' },
  assetSymbol: { color: '#6366f1', fontSize: 12, marginTop: 1 },
  assetValue: { color: '#fff', fontSize: 14, fontWeight: '600' },
  emptyText: { color: '#6b7280', fontSize: 13, textAlign: 'center', paddingVertical: 16 },
})
