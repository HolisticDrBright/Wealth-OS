import { useEffect, useState } from 'react'
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  TouchableOpacity, RefreshControl,
} from 'react-native'
import { supabase, apiFetch } from '@/lib/supabase'
import type { Alert } from '@/src/types'

const SEVERITY_COLOR = { info: '#6b7280', warning: '#f59e0b', critical: '#ef4444' }
const TYPE_EMOJI: Record<Alert['type'], string> = {
  trade_executed: '📈',
  risk_breach: '🚨',
  price_alert: '💹',
  simulation_done: '🔬',
  opportunity: '💡',
  system: 'ℹ️',
}

export default function AlertsScreen() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function load() {
    const res = await apiFetch('/api/alerts')
    if (res.ok) {
      const { data } = await res.json()
      setAlerts(data ?? [])
    }
    setLoading(false)
    setRefreshing(false)
  }

  async function markRead(id: string) {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, is_read: true } : a))
    await apiFetch('/api/alerts', {
      method: 'PATCH',
      body: JSON.stringify({ id }),
    })
  }

  async function markAll() {
    setAlerts(prev => prev.map(a => ({ ...a, is_read: true })))
    await apiFetch('/api/alerts', {
      method: 'PATCH',
      body: JSON.stringify({ all: true }),
    })
  }

  // Realtime
  useEffect(() => {
    // Wrap in an async IIFE so the setState calls inside load() happen after an
    // await (post-mount) rather than synchronously in the effect body. load() is
    // still invoked synchronously, so fetch timing is unchanged.
    void (async () => { await load() })()

    const channel = supabase
      .channel('mobile-alerts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' }, (payload) => {
        setAlerts(prev => [payload.new as Alert, ...prev])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  const unreadCount = alerts.filter(a => !a.is_read).length

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#6366f1" size="large" /></View>
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Alerts</Text>
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount}</Text>
            </View>
          )}
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={markAll} style={styles.markAllBtn}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={alerts}
        keyExtractor={a => a.id}
        contentContainerStyle={alerts.length === 0 ? styles.emptyContainer : styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load() }} tintColor="#6366f1" />}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>No alerts yet</Text>
            <Text style={styles.emptySubText}>Trade events and risk notifications will appear here</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.alertCard, item.is_read && styles.alertCardRead]}
            onPress={() => !item.is_read && markRead(item.id)}
            activeOpacity={0.8}
          >
            <Text style={styles.alertEmoji}>{TYPE_EMOJI[item.type] ?? 'ℹ️'}</Text>
            <View style={styles.alertBody}>
              <View style={styles.alertTop}>
                <Text style={styles.alertTitle}>{item.title}</Text>
                {!item.is_read && <View style={styles.unreadDot} />}
              </View>
              {item.body && <Text style={styles.alertBodyText} numberOfLines={2}>{item.body}</Text>}
              <Text style={[styles.alertMeta, { color: SEVERITY_COLOR[item.severity] }]}>
                {item.severity} · {item.type.replace('_', ' ')} · {new Date(item.created_at).toLocaleString()}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0b0f' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyContainer: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  badge: { backgroundColor: '#4f46e5', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  markAllBtn: { marginTop: 8 },
  markAllText: { color: '#6366f1', fontSize: 13 },
  list: { padding: 16 },
  emptyText: { color: '#9ca3af', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  emptySubText: { color: '#6b7280', fontSize: 13, textAlign: 'center', marginTop: 8 },
  alertCard: { flexDirection: 'row', gap: 12, backgroundColor: '#0f1117', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  alertCardRead: { opacity: 0.6 },
  alertEmoji: { fontSize: 22, marginTop: 2 },
  alertBody: { flex: 1 },
  alertTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alertTitle: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#6366f1' },
  alertBodyText: { color: '#9ca3af', fontSize: 13, marginTop: 2, lineHeight: 18 },
  alertMeta: { fontSize: 11, marginTop: 4, textTransform: 'capitalize' },
})
