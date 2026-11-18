/**
 * Approve a change (modal). GET /api/mobile/approve describes the pending
 * rebalance; POST records the approval THEN executes through the web's own
 * rebalance path (pre-execution guard per order). Nothing happens until the
 * user taps Approve.
 */

import { useState } from 'react'
import { View, Text, ScrollView, Pressable } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { api, useApi, type ApproveDecision } from '@/src/api'
import { Card, Money, PrimaryButton, SecondaryButton, StateView, SplitBar, formatUsd } from '@/src/ui'
import { colors } from '@/src/theme'

function stockShare(d: ApproveDecision, which: 'current' | 'target'): number | null {
  const t = d.trades.find(x => x.assetClass === 'stock')
  if (!t) return null
  return which === 'current' ? t.currentPct : t.targetPct
}

function MixBar({ label, stocksPct }: { label: string; stocksPct: number }) {
  const s = Math.round(stocksPct)
  return (
    <View className="gap-1.5">
      <View className="flex-row justify-between">
        <Text className="font-inter text-[13px] text-ink-secondary">{label}</Text>
        <Text className="font-inter text-[13px] text-ink-secondary">{s}% stocks · {100 - s}% other</Text>
      </View>
      <SplitBar aFraction={s / 100} bColor="#5b6275" label={`${label}: ${s}% stocks, ${100 - s}% other`} />
    </View>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="font-inter text-[14px] text-ink-secondary">{label}</Text>
      {children}
    </View>
  )
}

function summaryFor(d: ApproveDecision): string {
  return `Rebalance my core portfolio: move about ${formatUsd(d.amountMovedUsd)} back to my plan, ` +
    `estimated cost about ${formatUsd(d.estimatedCostUsd)}, estimated tax effect ${d.estimatedTaxUsd > 0 ? `about ${formatUsd(d.estimatedTaxUsd)}` : 'none'}.`
}

export default function ApproveScreen() {
  const { data, error, loading, reload } = useApi(api.approval)
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const d = data?.decision ?? null
  const before = d ? stockShare(d, 'current') : null
  const after = d ? stockShare(d, 'target') : null

  return (
    <SafeAreaView className="flex-1 bg-ground">
      <View className="flex-row items-center justify-between px-screen pb-2 pt-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => router.back()}
          className="-ml-3 h-11 w-11 items-center justify-center"
        >
          <Ionicons name="close" size={22} color={colors.ink} />
        </Pressable>
        <Text className="font-inter-semibold text-[12px] tracking-wider text-accent-text">NEEDS YOUR DECISION</Text>
      </View>

      {loading && !data ? (
        <StateView kind="loading" />
      ) : error && !data ? (
        <StateView kind="error" detail={error} onRetry={reload} />
      ) : !d ? (
        <StateView kind="empty" title="Nothing needs you right now" detail="Your portfolio is within your plan. We'll ask here when that changes." />
      ) : done ? (
        <View className="flex-1 justify-center gap-4 px-screen">
          <Text accessibilityRole="header" className="text-center font-inter-bold text-[22px] text-ink">Approved</Text>
          <Text className="text-center font-inter text-[14px] leading-5 text-ink-body">{done}</Text>
          <PrimaryButton title="Done" onPress={() => router.back()} />
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 16 }}>
            <View className="gap-2">
              <Text accessibilityRole="header" className="font-inter-bold text-[24px] leading-8 text-ink">{d.title}</Text>
              <Text className="font-inter text-[15px] leading-6 text-ink-body">{d.explanation}</Text>
            </View>

            {before != null && after != null && (
              <Card className="gap-3.5 p-[18px]">
                <Text accessibilityRole="header" className="font-inter-semibold text-[15px] text-ink">What changes</Text>
                <MixBar label="Now" stocksPct={before} />
                <MixBar label="After" stocksPct={after} />
              </Card>
            )}

            <Card className="gap-3 p-[18px]">
              <Row label="Amount moved"><Money value={d.amountMovedUsd} size={14} /></Row>
              <Row label="Estimated cost">
                <Text style={{ fontFamily: 'JetBrainsMono_600SemiBold', fontSize: 14, color: colors.ink }}>
                  about {formatUsd(d.estimatedCostUsd)}
                </Text>
              </Row>
              <Row label="Estimated tax effect">
                <Text style={{ fontFamily: 'JetBrainsMono_600SemiBold', fontSize: 14, color: colors.ink }}>
                  {d.estimatedTaxUsd > 0 ? `about ${formatUsd(d.estimatedTaxUsd)}` : 'none'}
                </Text>
              </Row>
              {d.badYearBeforeUsd != null && d.badYearAfterUsd != null && (
                <Row label="Bad-year drop">
                  <Text style={{ fontFamily: 'JetBrainsMono_600SemiBold', fontSize: 14, color: colors.ink, flexShrink: 1, textAlign: 'right' }}>
                    {formatUsd(Math.abs(d.badYearAfterUsd))}, from {formatUsd(Math.abs(d.badYearBeforeUsd))}
                  </Text>
                </Row>
              )}
            </Card>

            <Text className="font-inter text-[13px] leading-5 text-ink-secondary">{d.doNothing}</Text>
            {submitError && (
              <Text accessibilityLiveRegion="polite" className="font-inter text-[13px] text-loss">{submitError}</Text>
            )}
          </ScrollView>

          <View className="gap-2.5 border-t border-stroke px-screen pb-6 pt-4">
            <PrimaryButton
              title="Approve"
              busy={busy}
              onPress={async () => {
                setBusy(true); setSubmitError(null)
                try {
                  const res = await api.approve(summaryFor(d))
                  const skipped = res.skippedOrders.length
                  setDone(
                    res.executed > 0
                      ? `Done — ${res.executed} change${res.executed === 1 ? '' : 's'} placed. You can see them in Activity.`
                      : skipped > 0
                        ? 'Your approval is recorded. No orders were placed because Wealth OS is in practice mode — nothing real moved.'
                        : 'Your approval is recorded.'
                  )
                } catch (err) {
                  setSubmitError(err instanceof Error ? err.message : 'Approval failed — nothing changed.')
                } finally {
                  setBusy(false)
                }
              }}
            />
            <SecondaryButton title="Not now" onPress={() => router.back()} />
          </View>
        </>
      )}
    </SafeAreaView>
  )
}
