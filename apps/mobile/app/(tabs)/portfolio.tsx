import { useEffect, useState } from 'react'
import {
  View, Text, SectionList, StyleSheet, ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { supabase } from '@/lib/supabase'
import type { Asset, UserCopiedPosition } from '@/src/types'

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}

const CATEGORY_EMOJI: Record<string, string> = {
  stock: '📈', crypto: '₿', real_estate: '🏠', cash: '💵', bond: '🏦', other: '📦',
}

export default function PortfolioScreen() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [positions, setPositions] = useState<UserCopiedPosition[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [assetsRes, positionsRes] = await Promise.all([
      supabase.from('assets').select('*').eq('user_id', user.id).order('current_value', { ascending: false }),
      supabase.from('user_copied_positions').select('*').eq('user_id', user.id).eq('status', 'open').order('opened_at', { ascending: false }),
    ])

    setAssets(assetsRes.data ?? [])
    setPositions(positionsRes.data ?? [])
    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => { load() }, [])

  const totalAssets = assets.reduce((s, a) => s + a.current_value, 0)
  const totalCopied = positions.reduce((s, p) => s + p.notional_value, 0)
  const totalPnl = positions.reduce((s, p) => s + p.pnl_usd, 0)

  const sections = [
    { title: 'Holdings', data: assets },
    ...(positions.length > 0 ? [{ title: 'Copy Positions', data: positions as unknown[] }] : []),
  ]

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#6366f1" size="large" /></View>
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Portfolio</Text>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Holdings</Text>
            <Text style={styles.summaryValue}>{formatCurrency(totalAssets)}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Copy Trades</Text>
            <Text style={styles.summaryValue}>{formatCurrency(totalCopied)}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Open P&L</Text>
            <Text style={[styles.summaryValue, { color: totalPnl >= 0 ? '#10b981' : '#ef4444' }]}>
              {totalPnl >= 0 ? '+' : ''}{formatCurrency(totalPnl)}
            </Text>
          </View>
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => (item as { id: string }).id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load() }} tintColor="#6366f1" />}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle}>{section.title}</Text>
        )}
        renderItem={({ item, section }) => {
          if (section.title === 'Holdings') {
            const asset = item as Asset
            return (
              <View style={styles.assetCard}>
                <Text style={styles.assetEmoji}>{CATEGORY_EMOJI[asset.category] ?? '📦'}</Text>
                <View style={styles.assetInfo}>
                  <Text style={styles.assetName}>{asset.name}</Text>
                  {asset.symbol && <Text style={styles.assetSymbol}>{asset.symbol}</Text>}
                </View>
                <Text style={styles.assetValue}>{formatCurrency(asset.current_value)}</Text>
              </View>
            )
          }
          const pos = item as UserCopiedPosition
          return (
            <View style={styles.posCard}>
              <View style={styles.posInfo}>
                <Text style={styles.posSymbol}>{pos.symbol}</Text>
                <Text style={[styles.posAction, { color: pos.action === 'buy' ? '#10b981' : '#ef4444' }]}>
                  {pos.action.toUpperCase()}
                </Text>
              </View>
              <View style={styles.posRight}>
                <Text style={styles.posValue}>{formatCurrency(pos.notional_value)}</Text>
                <Text style={[styles.posPnl, { color: pos.pnl_usd >= 0 ? '#10b981' : '#ef4444' }]}>
                  {pos.pnl_usd >= 0 ? '+' : ''}{formatCurrency(pos.pnl_usd)}
                </Text>
              </View>
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
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 16 },
  summaryRow: { flexDirection: 'row', gap: 10 },
  summaryItem: { flex: 1, backgroundColor: '#0f1117', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  summaryLabel: { color: '#6b7280', fontSize: 11 },
  summaryValue: { color: '#fff', fontSize: 16, fontWeight: 'bold', marginTop: 2 },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  sectionTitle: { color: '#6b7280', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginTop: 20, marginBottom: 8 },
  assetCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#0f1117', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  assetEmoji: { fontSize: 20 },
  assetInfo: { flex: 1 },
  assetName: { color: '#fff', fontSize: 14, fontWeight: '500' },
  assetSymbol: { color: '#6366f1', fontSize: 12, marginTop: 1 },
  assetValue: { color: '#fff', fontSize: 14, fontWeight: '700' },
  posCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#0f1117', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  posInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  posSymbol: { color: '#818cf8', fontSize: 14, fontWeight: '700' },
  posAction: { fontSize: 11, fontWeight: '700' },
  posRight: { alignItems: 'flex-end' },
  posValue: { color: '#fff', fontSize: 14, fontWeight: '600' },
  posPnl: { fontSize: 12, marginTop: 2 },
})
