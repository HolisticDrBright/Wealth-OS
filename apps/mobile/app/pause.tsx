/**
 * Pause everything (modal). GET /api/mobile/pause gives the live impact;
 * POST runs the SAME pause core as the web's Flatten & Halt (halt flag first,
 * pending orders cancelled, optional sell-Explore through the runner's exit
 * path, audit row). "Sell Explore" sells strategy positions ONLY — Core funds
 * and Tier 1 Safety are never sold by a pause. On failure we show the error
 * and stay on the screen.
 */

import { useState } from 'react'
import { View, Text, ScrollView, Pressable } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { api, useApi, type PauseImpact } from '@/src/api'
import { Card, PrimaryButton, SecondaryButton, StateView, formatUsd } from '@/src/ui'
import { colors } from '@/src/theme'

type Choice = 'keep' | 'sell'

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

function OptionCard({ selected, title, detail, onPress }: {
  selected: boolean; title: string; detail: string; onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      className={`flex-row gap-3 rounded-card border p-card-pad ${selected ? 'border-accent bg-accent-card' : 'border-stroke bg-card'}`}
    >
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={22}
        color={selected ? colors.accent : colors.inkMuted}
        style={{ marginTop: 1 }}
      />
      <View className="flex-1 gap-1">
        <Text className="font-inter-semibold text-[15px] text-ink">{title}</Text>
        <Text className="font-inter text-[13px] leading-5 text-ink-secondary">{detail}</Text>
      </View>
    </Pressable>
  )
}

function keepDetail(i: PauseImpact): string {
  if (i.openPositions === 0) return 'Nothing is sold. You have no Explore positions right now.'
  return `Nothing is sold. Loss limits on your ${plural(i.openPositions, 'Explore position', 'Explore positions')} stay active.`
}

function sellDetail(i: PauseImpact): string {
  if (i.openPositions === 0) return 'You have no Explore positions to sell, so this is the same as keeping what you hold.'
  return `Sells your ${plural(i.openPositions, 'Explore position', 'Explore positions')}, worth ${formatUsd(i.openNotionalUsd)}, ` +
    `and keeps the cash. Estimated cost about ${formatUsd(i.estimatedExitCostUsd)}.`
}

export default function PauseScreen() {
  const { data, error, loading, reload } = useApi(api.pauseImpact)
  const [choice, setChoice] = useState<Choice>('keep')
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function pauseNow() {
    setBusy(true); setSubmitError(null)
    try {
      const res = await api.pause(choice === 'sell')
      if (!res.ok && res.failures.length > 0) {
        // Trading IS paused (the flag is set first) — but say what didn't close.
        setSubmitError(
          `Trading is paused, but ${plural(res.failures.length, 'position', 'positions')} could not be sold: ${res.failures.join('; ')}`
        )
        return
      }
      router.back()
    } catch (err) {
      setSubmitError(err instanceof Error ? `Pause failed: ${err.message}` : 'Pause failed — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-ground">
      <View className="flex-row items-center px-screen pb-2 pt-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => router.back()}
          className="-ml-3 h-11 w-11 items-center justify-center"
        >
          <Ionicons name="close" size={22} color={colors.ink} />
        </Pressable>
      </View>

      {loading && !data ? (
        <StateView kind="loading" />
      ) : error && !data ? (
        <StateView kind="error" detail={error} onRetry={reload} />
      ) : data ? (
        data.tradingHalted ? (
          <StateView
            kind="empty"
            title="Trading is already paused"
            detail="Turn it back on from the banner on Home when you're ready."
          />
        ) : (
          <>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 16 }}>
              <View className="gap-2">
                <Text accessibilityRole="header" className="font-inter-bold text-[24px] leading-8 text-ink">Pause everything</Text>
                <Text className="font-inter text-[15px] leading-6 text-ink-body">
                  Stops Wealth OS from placing any new trades until you turn it back on. Choose what happens to what you already hold.
                </Text>
              </View>

              <View accessibilityRole="radiogroup" className="gap-3">
                <OptionCard
                  selected={choice === 'keep'}
                  title="Stop new trades, keep what I hold"
                  detail={keepDetail(data)}
                  onPress={() => setChoice('keep')}
                />
                <OptionCard
                  selected={choice === 'sell'}
                  title="Stop new trades and sell Explore"
                  detail={sellDetail(data)}
                  onPress={() => setChoice('sell')}
                />
              </View>

              <Card className="gap-2.5">
                <Text accessibilityRole="header" className="font-inter-semibold text-[15px] text-ink">What stays the same</Text>
                <Text className="font-inter text-[14px] leading-5 text-ink-body">
                  Your core funds and your safety cushion are never sold by a pause — either way.
                </Text>
                <Text className="font-inter text-[14px] leading-5 text-ink-body">Your monthly deposit still arrives and waits as cash.</Text>
                <Text className="font-inter text-[14px] leading-5 text-ink-body">
                  {data.pendingOrders > 0
                    ? `${plural(data.pendingOrders, 'pending order', 'pending orders')} will be cancelled.`
                    : 'You have no pending orders to cancel.'}
                </Text>
              </Card>

              <Text className="font-inter text-[13px] leading-5 text-ink-secondary">
                Turning trading back on asks you to confirm, so it cannot happen by accident.
              </Text>
              {submitError && (
                <Text accessibilityLiveRegion="assertive" className="font-inter text-[13px] leading-5 text-loss">{submitError}</Text>
              )}
            </ScrollView>

            <View className="gap-2.5 border-t border-stroke px-screen pb-6 pt-4">
              <PrimaryButton caution title="Pause trading now" busy={busy} onPress={pauseNow} />
              <SecondaryButton title="Cancel" onPress={() => router.back()} />
            </View>
          </>
        )
      ) : null}
    </SafeAreaView>
  )
}
