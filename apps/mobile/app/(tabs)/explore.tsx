/**
 * Explore (Simple mode). GET /api/mobile/explore — cap meter + trader cards.
 * Ranking is the server's risk/delay-adjusted order; never raw return.
 * "Try with practice money" shows the plain-language summary and requires an
 * explicit approval, which the server records before following.
 */

import { useState } from 'react'
import { View, Text, ScrollView, RefreshControl, Modal } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api, useApi, type ExploreTrader } from '@/src/api'
import {
  Card, Pill, ProgressBar, PrimaryButton, SecondaryButton, StateView,
  ScreenHeader, Money, formatUsd,
} from '@/src/ui'
import { colors } from '@/src/theme'

const MARKET_LABEL: Record<string, string> = {
  stock: 'Stocks', crypto: 'Crypto', forex: 'Currencies', polymarket: 'Prediction markets',
}

function Pct({ pct, emphasized }: { pct: number; emphasized?: boolean }) {
  const up = pct >= 0
  const color = emphasized ? colors.ink : colors.inkSecondary
  return (
    <Text
      accessibilityLabel={`${up ? 'up' : 'down'} ${Math.abs(pct).toFixed(0)} percent`}
      style={{ fontFamily: 'JetBrainsMono_600SemiBold', fontSize: 16, color }}
    >
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}%
    </Text>
  )
}

function followSummary(t: ExploreTrader): string {
  return `Follow ${t.name} with practice money. Their trades will be copied into your Explore part, ` +
    `sized within your Explore limit, never touching your core portfolio. Nothing is copied with real money, ` +
    `and copying with real money stays off until a ${t.practiceRun?.totalDays ?? 30}-day practice run finishes.`
}

function TraderCard({ t, onTry, onStop }: { t: ExploreTrader; onTry: () => void; onStop: () => void }) {
  const inRun = t.following && t.practiceRun && !t.practiceRun.complete
  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1 gap-0.5">
          <Text className="font-inter-semibold text-[15px] text-ink">{t.name}</Text>
          <Text className="font-inter text-[13px] text-ink-secondary">{MARKET_LABEL[t.assetClass] ?? t.assetClass}</Text>
        </View>
        <Pill tone={t.swing === 'bigger' ? 'loss' : 'neutral'}>
          {t.swing === 'bigger' ? 'Bigger swings' : 'Lower swings'}
        </Pill>
      </View>

      {inRun && t.practiceRun ? (
        <View className="gap-1.5">
          <Text className="font-inter text-[13px] text-ink-body">
            Practice run: day {t.practiceRun.dayN} of {t.practiceRun.totalDays}
          </Text>
          <ProgressBar
            fraction={t.practiceRun.dayN / t.practiceRun.totalDays}
            label={`Practice run day ${t.practiceRun.dayN} of ${t.practiceRun.totalDays}`}
          />
          <Text className="font-inter text-[13px] leading-5 text-ink-secondary">
            You can copy with real money after the practice run finishes.
          </Text>
        </View>
      ) : (
        <>
          <View className="flex-row gap-2.5">
            <View className="flex-1 gap-1 rounded-[10px] bg-inset px-3 py-2.5">
              <Text className="font-inter text-[13px] text-ink-muted">Their result</Text>
              <Pct pct={t.copier.headlinePct} />
            </View>
            <View className="flex-1 gap-1 rounded-[10px] border border-accent-border bg-inset px-3 py-2.5">
              <Text className="font-inter text-[13px] text-accent-text">
                What a copier got{t.copier.isEstimate ? ' (est.)' : ''}
              </Text>
              <Pct pct={t.copier.copierPct} emphasized />
            </View>
          </View>
          <Text className="font-inter text-[13px] leading-5 text-ink-secondary">{t.copier.explanation}</Text>
        </>
      )}

      {t.following ? (
        <SecondaryButton title="Stop following" onPress={onStop} />
      ) : (
        <PrimaryButton title="Try with practice money" onPress={onTry} />
      )}
    </Card>
  )
}

function ApproveFollowSheet({ trader, onClose, onDone }: {
  trader: ExploreTrader; onClose: () => void; onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <View className="gap-4 rounded-t-card border border-stroke bg-card p-screen pb-10">
          <Text accessibilityRole="header" className="font-inter-bold text-[20px] text-ink">Before anything starts</Text>
          <Text className="font-inter text-[14px] leading-6 text-ink-body">{followSummary(trader)}</Text>
          {err && <Text accessibilityLiveRegion="polite" className="font-inter text-[13px] text-loss">{err}</Text>}
          <PrimaryButton
            title="I understand — start practice"
            busy={busy}
            onPress={async () => {
              setBusy(true); setErr(null)
              try {
                await api.follow(trader.id, followSummary(trader))
                onDone()
              } catch (e) {
                setErr(e instanceof Error ? e.message : 'Could not start — nothing changed.')
              } finally {
                setBusy(false)
              }
            }}
          />
          <SecondaryButton title="Not now" onPress={onClose} />
        </View>
      </View>
    </Modal>
  )
}

export default function ExploreScreen() {
  const { data, error, loading, refreshing, reload } = useApi(api.explore)
  const [approving, setApproving] = useState<ExploreTrader | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const usage = data?.usage
  const usedFraction = usage && usage.capUsd > 0 ? usage.usedUsd / usage.capUsd : 0

  return (
    <SafeAreaView className="flex-1 bg-ground" edges={['top']}>
      {loading && !data ? (
        <StateView kind="loading" />
      ) : error && !data ? (
        <StateView kind="error" detail={error} onRetry={reload} />
      ) : data && usage ? (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
        >
          <ScreenHeader
            title="Explore"
            subtitle="A small, fenced-off part of your money for strategies and copying traders. Your core portfolio is never touched."
          />

          <Card className="gap-2.5">
            <View className="flex-row items-baseline justify-between">
              <Text className="font-inter-semibold text-[15px] text-ink">Explore limit</Text>
              <Text className="font-inter text-[13px] text-ink-secondary">{Math.round(usage.capFraction * 100)}% of money outside Safety</Text>
            </View>
            <ProgressBar
              fraction={usedFraction}
              color={colors.explore}
              height={10}
              label={`${formatUsd(usage.usedUsd)} of your ${formatUsd(usage.capUsd)} Explore limit in use`}
            />
            <View className="flex-row justify-between">
              <View className="flex-row items-baseline gap-1">
                <Money value={usage.usedUsd} size={13} />
                <Text className="font-inter text-[13px] text-ink-secondary">in use</Text>
              </View>
              <View className="flex-row items-baseline gap-1">
                <Money value={usage.leftUsd} size={13} />
                <Text className="font-inter text-[13px] text-ink-secondary">left</Text>
              </View>
            </View>
            {usage.totalValueUsd <= 0 ? (
              <Text className="font-inter text-[13px] leading-5 text-loss">
                No recorded portfolio value yet, so the Explore limit is $0 — nothing can be copied until your money is recorded on the web app.
              </Text>
            ) : !usage.tier1Funded && usage.closedReason ? (
              <Text accessibilityRole="alert" className="font-inter text-[13px] leading-5 text-loss">
                {usage.closedReason}
              </Text>
            ) : null}
          </Card>

          <Text accessibilityRole="header" className="mt-1.5 font-inter-semibold text-[15px] text-ink">Traders you can copy</Text>
          {actionError && <Text className="font-inter text-[13px] text-loss">{actionError}</Text>}

          {data.traders.length === 0 ? (
            <StateView kind="empty" title="No traders available yet" detail="Traders appear here once the trader list has synced." />
          ) : (
            data.traders.map(t => (
              <TraderCard
                key={t.id}
                t={t}
                onTry={() => { setActionError(null); setApproving(t) }}
                onStop={async () => {
                  setActionError(null)
                  try { await api.unfollow(t.id); reload() }
                  catch (e) { setActionError(e instanceof Error ? e.message : 'Could not stop following') }
                }}
              />
            ))
          )}
        </ScrollView>
      ) : null}

      {approving && (
        <ApproveFollowSheet
          trader={approving}
          onClose={() => setApproving(null)}
          onDone={() => { setApproving(null); reload() }}
        />
      )}
    </SafeAreaView>
  )
}
