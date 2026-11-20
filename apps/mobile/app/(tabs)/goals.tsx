/**
 * Goals (Simple mode): detail of the primary goal, list if more than one.
 * Every number comes from GET /api/mobile/goal.
 */

import { useState } from 'react'
import { View, Text, ScrollView, RefreshControl, TextInput, Pressable, Modal } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api, useApi, monthYear, type GoalView } from '@/src/api'
import {
  Card, Pill, Money, ProgressBar, StateView, ScreenHeader,
  PrimaryButton, SecondaryButton, formatUsd,
} from '@/src/ui'
import { colors } from '@/src/theme'
import { LadderCard } from '@/src/ui/LadderCard'

function StatusPill({ status }: { status: GoalView['status'] }) {
  if (status === 'on_track') return <Pill tone="gain">On track</Pill>
  if (status === 'behind') return <Pill tone="loss">Behind</Pill>
  return <Pill tone="neutral">No date set</Pill>
}

function expectationSentence(g: GoalView): string {
  const monthly = formatUsd(g.monthlyContributionUsd)
  if (!g.expectedDate) {
    return g.monthlyContributionUsd > 0
      ? `At ${monthly} a month we can't estimate a date yet.`
      : 'Add a monthly deposit and we can estimate when you will get there.'
  }
  const when = monthYear(g.expectedDate)
  const lead = g.monthlyContributionUsd > 0 ? `At ${monthly} a month you are expected to get there in ${when}` : `With no monthly deposit you are expected to get there in ${when}`
  if (g.status === 'on_track') return `${lead}, on or before your target.`
  if (g.status === 'behind') return `${lead}, after your target date.`
  return `${lead}.`
}

function YearRow({ label, amount, tone }: { label: string; amount: number; tone: 'gain' | 'neutral' | 'loss' }) {
  const up = amount >= 0
  const color = tone === 'gain' ? colors.gain : tone === 'loss' ? colors.loss : colors.ink
  return (
    <View className="flex-row items-center justify-between" accessible accessibilityLabel={`${label}: ${up ? 'up' : 'down'} about ${formatUsd(Math.abs(amount))}`}>
      <Text className="font-inter text-[14px] text-ink-secondary">{label}</Text>
      <Text style={{ fontFamily: 'JetBrainsMono_600SemiBold', fontSize: 14, color }}>
        {up ? '▲' : '▼'} about {formatUsd(Math.abs(amount))}
      </Text>
    </View>
  )
}

function DepositModal({ goal, onClose, onSaved }: { goal: GoalView; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(String(Math.round(goal.monthlyContributionUsd)))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const amount = Number(value)
  const valid = value.trim() !== '' && Number.isFinite(amount) && amount >= 0

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <View className="gap-4 rounded-t-card border border-stroke bg-card p-screen pb-10">
          <Text accessibilityRole="header" className="font-inter-bold text-[20px] text-ink">Change monthly deposit</Text>
          <Text className="font-inter text-[13px] leading-5 text-ink-secondary">
            How much do you want to put toward {goal.name} each month?
          </Text>
          <TextInput
            accessibilityLabel="Monthly deposit in dollars"
            value={value}
            onChangeText={setValue}
            keyboardType="number-pad"
            className="min-h-[48px] rounded-btn border border-stroke bg-inset px-4 text-ink"
            style={{ fontFamily: 'JetBrainsMono_600SemiBold', fontSize: 18 }}
            placeholderTextColor={colors.inkMuted}
          />
          {err && <Text className="font-inter text-[13px] text-loss">{err}</Text>}
          <PrimaryButton
            title="Save"
            busy={busy}
            disabled={!valid}
            onPress={async () => {
              setBusy(true); setErr(null)
              try {
                await api.setMonthlyDeposit(goal.id, amount)
                onSaved()
              } catch (e) {
                setErr(e instanceof Error ? e.message : 'Could not save')
              } finally {
                setBusy(false)
              }
            }}
          />
          <SecondaryButton title="Cancel" onPress={onClose} />
        </View>
      </View>
    </Modal>
  )
}

export default function GoalsScreen() {
  const { data, error, loading, refreshing, reload } = useApi(api.goal)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const goals = data?.goals ?? []
  const goal = goals.find(g => g.id === selectedId) ?? goals[0] ?? null

  return (
    <SafeAreaView className="flex-1 bg-ground" edges={['top']}>
      {loading && !data ? (
        <StateView kind="loading" />
      ) : error && !data ? (
        <StateView kind="error" detail={error} onRetry={reload} />
      ) : !goal ? (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 14 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
        >
          <ScreenHeader title="Goals" />
          <Card>
            <Text className="font-inter-semibold text-[15px] text-ink">No goal yet</Text>
            <Text className="mt-1 font-inter text-[13px] leading-5 text-ink-secondary">
              Set up your first goal on the web app — everything here works toward it.
            </Text>
          </Card>
          {data && <LadderCard ladder={data.ladder} setupUsd={data.ladderSetupUsd} onChanged={reload} />}
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 14 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
        >
          <ScreenHeader title={goal.name} />

          {goals.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {goals.map(g => (
                <Pressable
                  key={g.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: g.id === goal.id }}
                  accessibilityLabel={`Show goal ${g.name}`}
                  onPress={() => setSelectedId(g.id)}
                  className={`min-h-[44px] justify-center rounded-pill border px-4 ${g.id === goal.id ? 'border-accent bg-accent-card' : 'border-stroke'}`}
                >
                  <Text className={g.id === goal.id ? 'font-inter-semibold text-[14px] text-accent-text' : 'font-inter-medium text-[14px] text-ink-body'}>{g.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {/* Progress */}
          <Card className="gap-2.5 p-[18px]">
            <View className="flex-row items-center justify-between">
              <StatusPill status={goal.status} />
              {goal.targetDate && (
                <Text className="font-inter text-[13px] text-ink-secondary">Target: {monthYear(goal.targetDate)}</Text>
              )}
            </View>
            <View className="flex-row flex-wrap items-baseline gap-2">
              <Money value={goal.savedUsd} size={32} />
              <Text className="font-inter text-[14px] text-ink-secondary">of {formatUsd(goal.targetAmountUsd)}</Text>
            </View>
            <ProgressBar fraction={goal.fraction} height={10} label={`${Math.round(goal.fraction * 100)}% of your goal saved`} />
            <Text className="font-inter text-[14px] leading-5 text-ink-body">{expectationSentence(goal)}</Text>
          </Card>

          {/* What a year could look like */}
          <Card className="gap-3 p-[18px]">
            <Text accessibilityRole="header" className="font-inter-semibold text-[15px] text-ink">What a year could look like</Text>
            {data?.yearRange ? (
              <>
                <YearRow label="Good year" amount={data.yearRange.goodYearUsd} tone="gain" />
                <YearRow label="Typical year" amount={data.yearRange.typicalYearUsd} tone="neutral" />
                <YearRow label="Bad year" amount={data.yearRange.badYearUsd} tone="loss" />
                <Text className="font-inter text-[13px] leading-5 text-ink-secondary">
                  These are estimates from how this kind of mix has behaved before, not promises.
                  {goal.badYearSetbackMonths != null
                    ? ` A bad year would push your goal back about ${goal.badYearSetbackMonths} month${goal.badYearSetbackMonths === 1 ? '' : 's'}.`
                    : ''}
                </Text>
              </>
            ) : (
              <Text className="font-inter text-[13px] text-ink-secondary">
                We can&apos;t estimate this right now — the market history we use is unavailable. Pull to refresh later.
              </Text>
            )}
          </Card>

          {/* Where the money is — the three-tier ladder */}
          {data && <LadderCard ladder={data.ladder} setupUsd={data.ladderSetupUsd} onChanged={reload} />}

          <SecondaryButton title="Change monthly deposit" onPress={() => setEditing(true)} />
        </ScrollView>
      )}

      {editing && goal && (
        <DepositModal
          goal={goal}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); reload() }}
        />
      )}
    </SafeAreaView>
  )
}
