/**
 * "Your best next dollar" (roadmap #1) on the phone Home screen. One thing at
 * a time: the highest-ranked question we still need, or the recommendation.
 * Plus the "save part of your raise" prompt and "income changed?". The server
 * (lib/advisory/next-dollar-data.ts) owns every rule; nothing here moves money.
 */

import { useState } from 'react'
import { View, Text, TextInput, Pressable } from 'react-native'
import { router } from 'expo-router'
import { api, type NextDollarView } from '@/src/api'
import { Card, PrimaryButton, SecondaryButton, formatUsd } from '@/src/ui'
import { colors } from '@/src/theme'

const inputClass = 'min-h-[48px] rounded-btn border border-stroke bg-inset px-4 text-ink'
const inputStyle = { fontFamily: 'JetBrainsMono_600SemiBold', fontSize: 16 }

export function NextDollarCard({ view, onChanged }: { view: NextDollarView; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [debtYes, setDebtYes] = useState(false)
  const [balance, setBalance] = useState('')
  const [apr, setApr] = useState('')
  const [incomeOpen, setIncomeOpen] = useState(false)
  const [income, setIncome] = useState('')

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null)
    try {
      await fn()
      setAmount(''); setBalance(''); setApr(''); setDebtYes(false); setIncome(''); setIncomeOpen(false)
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong — nothing was changed.')
    } finally {
      setBusy(false)
    }
  }

  const { card, raise } = view

  return (
    <Card tint="accent" className="gap-3 p-[18px]">
      <Text accessibilityRole="header" className="font-inter-semibold text-[15px] text-ink">Your best next dollar</Text>

      {card.kind === 'question' ? (
        <View className="gap-2">
          <Text className="font-inter text-[15px] leading-6 text-ink">{card.question.prompt}</Text>
          {card.question.help && <Text className="font-inter text-[13px] leading-5 text-ink-secondary">{card.question.help}</Text>}
          <Text className="font-inter text-[13px] leading-5 text-ink-secondary">Why we ask now: {card.why}</Text>

          {card.question.input === 'number' && (
            <>
              <TextInput
                accessibilityLabel={`${card.question.prompt} Amount in dollars`}
                value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="0"
                placeholderTextColor={colors.inkMuted} className={inputClass} style={inputStyle}
              />
              <PrimaryButton
                title="Save" busy={busy} disabled={amount.trim() === '' || !(Number(amount) >= 0)}
                onPress={() => run(() => api.nextDollarAnswer({ fact: card.fact, amount: Number(amount) }))}
              />
            </>
          )}

          {card.question.input === 'choice' && card.question.choices?.map(c => (
            <SecondaryButton
              key={c.value} title={c.label} disabled={busy}
              onPress={() => run(() => api.nextDollarAnswer({ fact: card.fact, choice: c.value }))}
            />
          ))}

          {card.question.input === 'debt' && !debtYes && (
            <View className="flex-row gap-2">
              <SecondaryButton title="Yes" disabled={busy} className="flex-1" onPress={() => setDebtYes(true)} />
              <SecondaryButton
                title="No" disabled={busy} className="flex-1"
                onPress={() => run(() => api.nextDollarAnswer({ fact: 'debts', none: true }))}
              />
            </View>
          )}
          {card.question.input === 'debt' && debtYes && (
            <>
              <TextInput
                accessibilityLabel="Balance owed in dollars" value={balance} onChangeText={setBalance}
                keyboardType="number-pad" placeholder="Balance owed ($)" placeholderTextColor={colors.inkMuted}
                className={inputClass} style={inputStyle}
              />
              <TextInput
                accessibilityLabel="Interest rate in percent" value={apr} onChangeText={setApr}
                keyboardType="decimal-pad" placeholder="Interest rate (%)" placeholderTextColor={colors.inkMuted}
                className={inputClass} style={inputStyle}
              />
              <PrimaryButton
                title="Save" busy={busy}
                disabled={!(Number(balance) > 0) || apr.trim() === '' || !(Number(apr) >= 0)}
                onPress={() => run(() => api.nextDollarAnswer({ fact: 'debts', balanceUsd: Number(balance), aprPct: Number(apr) }))}
              />
            </>
          )}

          <Pressable
            accessibilityRole="button" accessibilityLabel={card.question.skipLabel} disabled={busy}
            onPress={() => run(() => api.nextDollarSkip(card.fact))} className="min-h-[44px] justify-center"
          >
            <Text className="font-inter text-[14px] text-ink-secondary underline">{card.question.skipLabel}</Text>
          </Pressable>
          <Text className="font-inter text-[13px] text-ink-secondary">
            {card.progress.answered} of {card.progress.total} answered. One question at a time.
          </Text>
        </View>
      ) : (
        <View className="gap-2">
          <Text className="font-inter-bold text-[18px] leading-6 text-ink">{card.title}</Text>
          <Text className="font-inter text-[14px] leading-5 text-ink-body">{card.body}</Text>
          {card.skippedChecks.length > 0 && (
            <Text className="font-inter text-[13px] leading-5 text-ink-secondary">
              We couldn&apos;t check {card.skippedChecks.join(', ')} yet.
            </Text>
          )}
          {card.action === 'add_money' && (
            <PrimaryButton title="Add money" onPress={() => router.push('/goals')} />
          )}
        </View>
      )}

      {raise && (
        <View className="gap-2 rounded-btn border border-stroke bg-inset p-3.5">
          <Text className="font-inter-semibold text-[13px] text-gain">YOU GOT A RAISE</Text>
          <Text className="font-inter text-[14px] leading-5 text-ink">
            Your income went up by about {formatUsd(raise.raiseUsd)} a year. Saving half of what reaches your paycheck would add{' '}
            {formatUsd(raise.increaseUsd)} a month to &ldquo;{raise.goalName}&rdquo; — from {formatUsd(raise.currentMonthlyUsd)} to {formatUsd(raise.suggestedMonthlyUsd)}.
          </Text>
          <PrimaryButton title={`Raise my deposit to ${formatUsd(raise.suggestedMonthlyUsd)}`} busy={busy} onPress={() => run(() => api.resolveRaise(true))} />
          <SecondaryButton title="Not now" disabled={busy} onPress={() => run(() => api.resolveRaise(false))} />
        </View>
      )}

      {incomeOpen ? (
        <View className="gap-2">
          <TextInput
            accessibilityLabel="Household income per year before tax, in dollars" value={income} onChangeText={setIncome}
            keyboardType="number-pad" placeholder="Income per year ($)" placeholderTextColor={colors.inkMuted}
            className={inputClass} style={inputStyle}
          />
          <PrimaryButton
            title="Save income" busy={busy} disabled={income.trim() === '' || !(Number(income) >= 0)}
            onPress={() => run(() => api.updateIncome(Number(income)))}
          />
        </View>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="Income changed? Update it" onPress={() => setIncomeOpen(true)} className="min-h-[44px] justify-center">
          <Text className="font-inter text-[13px] text-ink-secondary underline">Income changed? Update it</Text>
        </Pressable>
      )}

      {err && <Text accessibilityLiveRegion="polite" className="font-inter text-[13px] text-loss">{err}</Text>}
      <Text className="font-inter text-[13px] text-ink-secondary">{view.disclaimer}</Text>
    </Card>
  )
}
