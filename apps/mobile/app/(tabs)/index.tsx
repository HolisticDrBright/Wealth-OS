/**
 * Home (Simple mode). Every number comes from GET /api/mobile/home.
 */

import { useState } from 'react'
import { View, Text, ScrollView, Pressable, RefreshControl, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { api, useApi, monthYear, type GoalView } from '@/src/api'
import {
  Card, Pill, PracticeBadge, Money, Delta, ProgressBar, StateView, formatUsd,
} from '@/src/ui'
import { LineChart } from '@/src/ui/LineChart'
import { colors } from '@/src/theme'

function GoalPill({ status }: { status: GoalView['status'] }) {
  if (status === 'on_track') return <Pill tone="gain">On track</Pill>
  if (status === 'behind') return <Pill tone="loss">Behind</Pill>
  return <Pill tone="neutral">No date set</Pill>
}

function PausedBanner({ onResumed }: { onResumed: () => void }) {
  const [busy, setBusy] = useState(false)
  const confirmResume = () => {
    // Explicit confirmation step — turning trading back on can't happen by accident.
    Alert.alert(
      'Turn trading back on?',
      'Wealth OS will start placing new practice trades again, within your limits.',
      [
        { text: 'Keep paused', style: 'cancel' },
        {
          text: 'Turn back on',
          style: 'destructive',
          onPress: async () => {
            setBusy(true)
            try {
              await api.resume()
              onResumed()
            } catch (err) {
              Alert.alert("Couldn't turn trading back on", err instanceof Error ? err.message : 'Please try again.')
            } finally {
              setBusy(false)
            }
          },
        },
      ],
    )
  }
  return (
    <Card className="border-loss bg-loss-bg">
      <Text className="font-inter-semibold text-[15px] text-loss">Trading is paused</Text>
      <Text className="mt-1 font-inter text-[13px] leading-5 text-ink-body">
        Nothing new will be bought or sold until you turn it back on.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Turn trading back on"
        disabled={busy}
        onPress={confirmResume}
        className="mt-3 min-h-[44px] items-center justify-center rounded-btn border border-loss"
      >
        <Text className="font-inter-semibold text-[14px] text-loss">{busy ? 'Turning on…' : 'Turn trading back on'}</Text>
      </Pressable>
    </Card>
  )
}

export default function HomeScreen() {
  const { data, error, loading, refreshing, reload } = useApi(api.home)

  return (
    <SafeAreaView className="flex-1 bg-ground" edges={['top']}>
      {/* Header: never hides the practice badge while in paper mode */}
      <View className="flex-row items-center justify-between px-screen pb-3 pt-2">
        <View className="flex-1 flex-row flex-wrap items-center gap-2.5 pr-3">
          <Text accessibilityRole="header" className="font-inter-bold text-[17px] text-ink">Wealth OS</Text>
          {(data?.practiceMode ?? true) && <PracticeBadge />}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pause everything"
          accessibilityHint="Opens options to stop all new trades"
          onPress={() => router.push('/pause')}
          className="h-11 w-11 items-center justify-center rounded-btn border border-stroke bg-card"
        >
          <Ionicons name="shield-outline" size={20} color={colors.ink} />
        </Pressable>
      </View>

      {loading && !data ? (
        <StateView kind="loading" />
      ) : error && !data ? (
        <StateView kind="error" detail={error} onRetry={reload} />
      ) : data ? (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
        >
          {data.tradingHalted && <PausedBanner onResumed={reload} />}

          {/* You have */}
          <View className="gap-1.5">
            <Text className="font-inter text-[13px] text-ink-secondary">You have</Text>
            <Money value={data.totalValueUsd} size={40} />
            <View className="flex-row flex-wrap gap-x-3.5 gap-y-1">
              <Delta amount={data.todayChangeUsd} label="today" />
              <Delta amount={data.sinceStartChangeUsd} label="since you started" muted />
            </View>
            <LineChart points={data.valueSeries} />
          </View>

          {/* Goal */}
          {data.goal ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Goal ${data.goal.name}, ${formatUsd(data.goal.savedUsd)} of ${formatUsd(data.goal.targetAmountUsd)}. Opens Goals.`}
              onPress={() => router.push('/goals')}
            >
              <Card className="gap-2.5">
                <View className="flex-row items-center justify-between">
                  <Text className="flex-1 font-inter-semibold text-[15px] text-ink">{data.goal.name}</Text>
                  <GoalPill status={data.goal.status} />
                </View>
                <ProgressBar fraction={data.goal.fraction} label={`${Math.round(data.goal.fraction * 100)}% of your goal saved`} />
                <View className="flex-row flex-wrap justify-between gap-1">
                  <Text className="font-inter text-[13px] text-ink-secondary">
                    {formatUsd(data.goal.savedUsd)} of {formatUsd(data.goal.targetAmountUsd)}
                  </Text>
                  <Text className="font-inter text-[13px] text-ink-secondary">
                    {data.goal.expectedDate ? `Expected ${monthYear(data.goal.expectedDate)}` : "Can't estimate a date yet"}
                  </Text>
                </View>
              </Card>
            </Pressable>
          ) : (
            <Card>
              <Text className="font-inter text-[13px] leading-5 text-ink-secondary">
                No goal yet. Set one up on the web app — everything here works toward a goal you choose.
              </Text>
            </Card>
          )}

          {/* Needs your decision */}
          {data.decision ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Needs your decision: ${data.decision.title}. Opens the details.`}
              onPress={() => router.push(data.decision?.kind === 'ladder_expenses' ? '/goals' : '/approve')}
            >
              <Card tint="accent" className="flex-row items-center gap-3">
                <View className="flex-1 gap-1">
                  <Text className="font-inter-semibold text-[13px] tracking-wider text-accent-text">NEEDS YOUR DECISION</Text>
                  <Text className="font-inter-semibold text-[15px] text-ink">{data.decision.title}</Text>
                  <Text className="font-inter text-[13px] text-ink-secondary">{data.decision.subtitle}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.accentText} />
              </Card>
            </Pressable>
          ) : (
            <Card>
              <Text className="font-inter text-[13px] text-ink-muted">Nothing needs you right now.</Text>
            </Card>
          )}

          {/* This week */}
          <View className="gap-2.5">
            <View className="flex-row items-center justify-between">
              <Text accessibilityRole="header" className="font-inter-semibold text-[15px] text-ink">What happened this week</Text>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="See all activity"
                onPress={() => router.push('/activity')}
                className="min-h-[44px] justify-center"
              >
                <Text className="font-inter-medium text-[13px] text-accent">See all</Text>
              </Pressable>
            </View>
            {data.weekItems.length > 0 ? (
              data.weekItems.slice(0, 3).map((item, i) => (
                <View key={i} className="flex-row gap-2.5">
                  <View className="mt-[7px] h-1.5 w-1.5 rounded-full bg-accent" />
                  <Text className="flex-1 font-inter text-[14px] leading-5 text-ink-body">{item}</Text>
                </View>
              ))
            ) : (
              <Text className="font-inter text-[13px] text-ink-muted">A quiet week — no trades, nothing skipped, nothing sold.</Text>
            )}
          </View>

          {error && <Text className="font-inter text-[13px] text-loss">Last refresh failed: {error}</Text>}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  )
}
