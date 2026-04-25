import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

const ITEMS = [
  {
    label: 'AI Features',
    subtitle: 'Manage paid AI capabilities & budgets',
    icon: 'sparkles-outline' as const,
    href: '/(tabs)/profile/ai-features',
  },
]

export default function ProfileScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Profile</Text>

      {ITEMS.map(item => (
        <TouchableOpacity
          key={item.href}
          style={styles.row}
          onPress={() => router.push(item.href as Parameters<typeof router.push>[0])}
          activeOpacity={0.7}
        >
          <View style={styles.rowIcon}>
            <Ionicons name={item.icon} size={20} color="#8b5cf6" />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>{item.label}</Text>
            <Text style={styles.rowSub}>{item.subtitle}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#6b7280" />
        </TouchableOpacity>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0b0f' },
  content: { padding: 20, paddingTop: 60 },
  heading: { color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(139,92,246,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowText: { flex: 1 },
  rowLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  rowSub: { color: '#6b7280', fontSize: 12, marginTop: 2 },
})
