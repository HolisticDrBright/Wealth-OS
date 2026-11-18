/**
 * Activity (Simple mode): every action in plain English, grouped by week,
 * including skipped/blocked trades with the reason. GET /api/mobile/activity.
 */

import { useMemo, useState } from 'react'
import { View, Text, SectionList, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api, useApi, type ActivityItem } from '@/src/api'
import { FilterPill, StateView, ScreenHeader } from '@/src/ui'
import { colors } from '@/src/theme'

type Filter = 'all' | 'trade' | 'skipped'

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'Everything' },
  { key: 'trade', label: 'Trades' },
  { key: 'skipped', label: 'Skipped' },
]

function startOfWeek(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))   // Monday
  return x
}

function weekLabel(iso: string): string {
  const thisWeek = startOfWeek(new Date()).getTime()
  const wk = startOfWeek(new Date(iso)).getTime()
  const weeksAgo = Math.round((thisWeek - wk) / (7 * 86_400_000))
  if (weeksAgo <= 0) return 'THIS WEEK'
  if (weeksAgo === 1) return 'LAST WEEK'
  return `${weeksAgo} WEEKS AGO`
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const sameWeek = startOfWeek(d).getTime() === startOfWeek(new Date()).getTime()
  return sameWeek
    ? d.toLocaleDateString('en-US', { weekday: 'short' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function ActivityCard({ item }: { item: ActivityItem }) {
  return (
    <View
      accessible
      accessibilityLabel={`${item.sleeve}, ${item.type}, ${dayLabel(item.dateIso)}. ${item.headline}. ${item.why}`}
      className="mb-2.5 gap-1.5 rounded-btn-lg border border-stroke bg-card px-4 py-3.5"
    >
      <View className="flex-row justify-between">
        <Text className="font-inter text-[13px] text-ink-muted">{item.sleeve} · {item.type}</Text>
        <Text className="font-inter text-[13px] text-ink-muted">{dayLabel(item.dateIso)}</Text>
      </View>
      <Text className="font-inter-semibold text-[15px] text-ink">{item.headline}</Text>
      <Text className="font-inter text-[13px] leading-5 text-ink-secondary">{item.why}</Text>
    </View>
  )
}

export default function ActivityScreen() {
  const { data, error, loading, refreshing, reload } = useApi(api.activity)
  const [filter, setFilter] = useState<Filter>('all')

  const sections = useMemo(() => {
    const items = (data?.items ?? []).filter(i => filter === 'all' || i.kind === filter)
    const groups = new Map<string, ActivityItem[]>()
    for (const item of items) {
      const k = weekLabel(item.dateIso)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(item)
    }
    return [...groups.entries()].map(([title, rows]) => ({ title, data: rows }))
  }, [data, filter])

  return (
    <SafeAreaView className="flex-1 bg-ground" edges={['top']}>
      <View className="px-screen">
        <ScreenHeader title="Activity" />
        <View className="flex-row flex-wrap gap-2 pb-2">
          {FILTERS.map(f => (
            <FilterPill key={f.key} title={f.label} active={filter === f.key} onPress={() => setFilter(f.key)} />
          ))}
        </View>
      </View>

      {loading && !data ? (
        <StateView kind="loading" />
      ) : error && !data ? (
        <StateView kind="error" detail={error} onRetry={reload} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={i => i.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, flexGrow: 1 }}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
          renderSectionHeader={({ section }) => (
            <Text accessibilityRole="header" className="mb-2 mt-3 font-inter-semibold text-[13px] tracking-wider text-ink-muted">
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => <ActivityCard item={item} />}
          ListEmptyComponent={
            <StateView
              kind="empty"
              title={filter === 'skipped' ? 'Nothing skipped lately' : 'No activity in the last four weeks'}
              detail="Every trade, and every trade idea we pass on, will show up here with the reason."
            />
          }
        />
      )}
    </SafeAreaView>
  )
}
