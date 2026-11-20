/**
 * "Where the money is" — the three-tier ladder (Phase 2.4): one row per tier
 * with dollars, what the tier is for, and whether it is funded. Hosts the
 * monthly-expenses input when Tier 1 can't be sized yet, and the shortcut to
 * the "Set up your safety cushion" decision.
 */

import { useState } from 'react'
import { View, Text, TextInput } from 'react-native'
import { router } from 'expo-router'
import { api, type Ladder } from '@/src/api'
import { Card, Pill, Money, PrimaryButton, formatUsd } from '@/src/ui'
import { colors } from '@/src/theme'

function TierRow({ n, name, amount, of, status, statusOk, body }: {
  n: number
  name: string
  amount: number
  of?: number | null
  status: string
  statusOk: boolean
  body: string
}) {
  return (
    <View
      accessible
      accessibilityLabel={`Tier ${n}, ${name}: ${formatUsd(amount)}${of != null ? ` of ${formatUsd(of)}` : ''}. ${status}. ${body}`}
      className="gap-1.5 rounded-btn border border-stroke bg-inset p-3.5"
    >
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="font-inter-semibold text-[15px] text-ink">{n} · {name}</Text>
        <Pill tone={statusOk ? 'gain' : 'loss'}>{statusOk ? '✓ ' : '! '}{status}</Pill>
      </View>
      <View className="flex-row flex-wrap items-baseline gap-1.5">
        <Money value={amount} size={18} />
        {of != null && <Text className="font-inter text-[13px] text-ink-secondary">of {formatUsd(of)}</Text>}
      </View>
      <Text className="font-inter text-[13px] leading-5 text-ink-secondary">{body}</Text>
    </View>
  )
}

export function LadderCard({ ladder, setupUsd, onChanged }: {
  ladder: Ladder
  setupUsd: number
  onChanged: () => void
}) {
  const [expenses, setExpenses] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const t1 = ladder.tier1
  const stockPct = Math.round(ladder.core.stockShare * 100)

  const t1Status = t1.status === 'funded' ? 'Funded'
    : t1.status === 'short' ? `${formatUsd(t1.shortfallUsd)} short`
    : 'Needs your expenses'
  const t1Body = 'Cash-like money for emergencies' +
    (t1.emergencyUsd != null ? ` — ${formatUsd(t1.emergencyUsd)} covers 6 months of essentials` : '') +
    (t1.shortGoals.length > 0 ? `, plus ${formatUsd(t1.shortGoalsUsd)} for goals due within 2 years` : '') + '.'

  return (
    <Card className="gap-3 p-[18px]">
      <Text accessibilityRole="header" className="font-inter-semibold text-[15px] text-ink">Where the money is</Text>
      <Text className="font-inter text-[13px] leading-5 text-ink-secondary">
        Filled in order: safety first, then long-term investing, then a small slice for strategies.
      </Text>

      <TierRow n={1} name="Safety" amount={t1.heldUsd} of={t1.targetUsd} status={t1Status} statusOk={t1.funded} body={t1Body} />

      {t1.status === 'needs_expenses' && (
        <View className="gap-2">
          <Text className="font-inter text-[13px] text-ink-body">What do you spend each month on the essentials?</Text>
          <TextInput
            accessibilityLabel="Essential monthly expenses in dollars"
            value={expenses}
            onChangeText={setExpenses}
            keyboardType="number-pad"
            placeholder="3000"
            placeholderTextColor={colors.inkMuted}
            className="min-h-[48px] rounded-btn border border-stroke bg-inset px-4 text-ink"
            style={{ fontFamily: 'JetBrainsMono_600SemiBold', fontSize: 16 }}
          />
          <PrimaryButton
            title="Save"
            busy={busy}
            disabled={expenses.trim() === '' || !(Number(expenses) >= 0)}
            onPress={async () => {
              setBusy(true); setErr(null)
              try { await api.setMonthlyExpenses(Number(expenses)); onChanged() }
              catch (e) { setErr(e instanceof Error ? e.message : 'Could not save') }
              finally { setBusy(false) }
            }}
          />
        </View>
      )}

      {setupUsd > 0 && (
        <PrimaryButton
          title={`Set up my safety cushion (${formatUsd(setupUsd)})`}
          onPress={() => router.push('/approve')}
        />
      )}

      <TierRow
        n={2}
        name="Core"
        amount={ladder.core.amountUsd}
        status={t1.funded ? 'Invested' : 'Waits for Safety'}
        statusOk={t1.funded}
        body={`Long-term money in broad, low-cost funds: ${stockPct}% stocks, ${100 - stockPct}% bonds. The stock share steps down as your goals get closer.`}
      />

      <TierRow
        n={3}
        name="Explore"
        amount={ladder.explore.inUseUsd}
        of={ladder.explore.capUsd}
        status={ladder.explore.open ? `${formatUsd(ladder.explore.leftUsd)} left` : 'Paused'}
        statusOk={ladder.explore.open}
        body={`A small, fenced-off slice (${Math.round(ladder.explore.capFraction * 100)}% of money outside Safety) for strategies and copying.` +
          (ladder.explore.open ? '' : ' It stays at $0 until your safety cushion is full.')}
      />

      {err && <Text accessibilityLiveRegion="polite" className="font-inter text-[13px] text-loss">{err}</Text>}
    </Card>
  )
}
