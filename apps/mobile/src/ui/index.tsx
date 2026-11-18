/**
 * Shared Simple-mode UI components (Phase M1).
 *
 * Rules these components enforce so screens can't get them wrong:
 *  - every money figure renders in JetBrains Mono (<Money/>),
 *  - gains/losses are NEVER color-only: <Delta/> always pairs ▲/▼ with color,
 *  - touch targets are at least 44pt,
 *  - every screen has loading / empty / error states (<StateView/>).
 */

import type { ReactNode } from 'react'
import {
  View, Text, Pressable, ActivityIndicator,
  type ViewProps, type PressableProps,
} from 'react-native'
import { colors } from '@/src/theme'

// ─── Formatting ──────────────────────────────────────────────────────────────

/** $12,345 (whole dollars; sign never shown — pair with <Delta/> for change). */
export function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Math.abs(n) < 0.5 ? 0 : n)
}

// ─── Card ────────────────────────────────────────────────────────────────────

export function Card({ tint, className, children, ...rest }: ViewProps & {
  tint?: 'default' | 'accent'
  className?: string
  children: ReactNode
}) {
  const base = tint === 'accent'
    ? 'bg-accent-card border-accent-border'
    : 'bg-card border-stroke'
  return (
    <View className={`rounded-card border p-card-pad ${base} ${className ?? ''}`} {...rest}>
      {children}
    </View>
  )
}

// ─── Pill ────────────────────────────────────────────────────────────────────

export type PillTone = 'gain' | 'loss' | 'neutral' | 'accent' | 'practice'

const PILL_TONES: Record<PillTone, { bg: string; text: string }> = {
  gain:     { bg: 'bg-gain-bg',     text: 'text-gain' },
  loss:     { bg: 'bg-loss-bg',     text: 'text-loss' },
  neutral:  { bg: 'bg-stroke',      text: 'text-ink-body' },
  accent:   { bg: 'bg-accent-card', text: 'text-accent-text' },
  practice: { bg: 'bg-practice-bg', text: 'text-practice' },
}

export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  const t = PILL_TONES[tone]
  return (
    <View className={`rounded-pill px-2 py-0.5 ${t.bg}`}>
      <Text className={`font-inter-semibold text-[13px] ${t.text}`}>{children}</Text>
    </View>
  )
}

/** The paper-mode badge. Must never be hidden while the account is in paper mode. */
export function PracticeBadge() {
  return (
    <View className="rounded-[5px] bg-practice-bg px-[7px] py-[3px]">
      <Text className="font-inter-bold text-[13px] tracking-wider text-practice">PRACTICE MONEY</Text>
    </View>
  )
}

// ─── Money ───────────────────────────────────────────────────────────────────

/** Every money figure goes through this — JetBrains Mono, whole dollars. */
export function Money({ value, size = 16, color, semibold = true }: {
  value: number
  size?: number
  color?: string
  semibold?: boolean
}) {
  return (
    <Text
      style={{
        fontFamily: semibold ? 'JetBrainsMono_600SemiBold' : 'JetBrainsMono_500Medium',
        fontSize: size,
        color: color ?? colors.ink,
      }}
    >
      {formatUsd(value)}
    </Text>
  )
}

/**
 * A gain/loss figure: ▲/▼ + color together, never color alone.
 * `label` continues the sentence ("today", "since you started").
 */
export function Delta({ amount, label, size = 13, muted }: {
  amount: number
  label?: string
  size?: number
  /** Render the arrow+amount in secondary ink (used for long-horizon lines). */
  muted?: boolean
}) {
  const up = amount >= 0
  const arrow = up ? '▲' : '▼'   // ▲ ▼
  const color = muted ? colors.inkSecondary : up ? colors.gain : colors.loss
  return (
    <Text
      accessibilityLabel={`${up ? 'up' : 'down'} ${formatUsd(Math.abs(amount))}${label ? ` ${label}` : ''}`}
      style={{ fontFamily: 'Inter_500Medium', fontSize: size, color }}
    >
      {arrow} {formatUsd(Math.abs(amount))}{label ? ` ${label}` : ''}
    </Text>
  )
}

// ─── Progress bar ────────────────────────────────────────────────────────────

export function ProgressBar({ fraction, color = colors.accent, height = 8, label }: {
  /** 0..1, clamped. */
  fraction: number
  color?: string
  height?: number
  /** Screen-reader description, e.g. "60% of your goal saved". */
  label: string
}) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
      style={{ height, borderRadius: 999, backgroundColor: colors.stroke, overflow: 'hidden' }}
    >
      <View style={{ width: `${pct}%`, height, borderRadius: 999, backgroundColor: color }} />
    </View>
  )
}

/** Two-segment split bar (e.g. Core vs Explore). */
export function SplitBar({ aFraction, aColor = colors.accent, bColor = colors.explore, height = 10, label }: {
  aFraction: number
  aColor?: string
  bColor?: string
  height?: number
  label: string
}) {
  const a = Math.max(0, Math.min(1, aFraction)) * 100
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', height, borderRadius: 999, overflow: 'hidden', gap: 2 }}
    >
      <View style={{ width: `${a}%`, backgroundColor: aColor }} />
      <View style={{ flex: 1, backgroundColor: bColor }} />
    </View>
  )
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

export function PrimaryButton({ title, caution, disabled, busy, className, ...rest }: PressableProps & {
  title: string
  /** Caution-orange variant (Pause). */
  caution?: boolean
  busy?: boolean
  className?: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled || !!busy }}
      disabled={disabled || busy}
      className={`min-h-[52px] items-center justify-center rounded-btn-lg ${caution ? 'bg-loss' : 'bg-accent'} ${disabled || busy ? 'opacity-50' : ''} ${className ?? ''}`}
      {...rest}
    >
      {busy
        ? <ActivityIndicator color={caution ? '#2a1404' : colors.accentOn} />
        : <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 16, color: caution ? '#2a1404' : colors.accentOn }}>{title}</Text>}
    </Pressable>
  )
}

export function SecondaryButton({ title, disabled, className, ...rest }: PressableProps & {
  title: string
  className?: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      className={`min-h-[48px] items-center justify-center rounded-btn-lg border border-stroke ${disabled ? 'opacity-50' : ''} ${className ?? ''}`}
      {...rest}
    >
      <Text className="font-inter-semibold text-[15px] text-ink">{title}</Text>
    </Pressable>
  )
}

/** A pill-shaped filter toggle (Activity filters). ≥44pt tall. */
export function FilterPill({ title, active, ...rest }: PressableProps & {
  title: string
  active: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Filter: ${title}`}
      className={`min-h-[44px] justify-center rounded-pill border px-4 ${active ? 'border-accent bg-accent-card' : 'border-stroke bg-transparent'}`}
      {...rest}
    >
      <Text className={active ? 'font-inter-semibold text-[14px] text-accent-text' : 'font-inter-medium text-[14px] text-ink-body'}>
        {title}
      </Text>
    </Pressable>
  )
}

// ─── Screen header ───────────────────────────────────────────────────────────

export function ScreenHeader({ title, subtitle, right }: {
  title: string
  subtitle?: string
  right?: ReactNode
}) {
  return (
    <View className="gap-1.5 pb-3 pt-2">
      <View className="flex-row items-center justify-between">
        <Text className="font-inter-bold text-[24px] text-ink">{title}</Text>
        {right}
      </View>
      {subtitle ? (
        <Text className="font-inter text-[14px] leading-5 text-ink-secondary">{subtitle}</Text>
      ) : null}
    </View>
  )
}

// ─── State views (loading / empty / error) ───────────────────────────────────

export function StateView({ kind, title, detail, onRetry }: {
  kind: 'loading' | 'empty' | 'error'
  title?: string
  detail?: string
  onRetry?: () => void
}) {
  if (kind === 'loading') {
    return (
      <View className="flex-1 items-center justify-center py-16" accessibilityLabel="Loading">
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    )
  }
  return (
    <View className="flex-1 items-center justify-center gap-2 px-8 py-16">
      <Text className="text-center font-inter-semibold text-[15px] text-ink">
        {title ?? (kind === 'error' ? "We couldn't load this" : 'Nothing here yet')}
      </Text>
      {detail ? (
        <Text className="text-center font-inter text-[13px] leading-5 text-ink-secondary">{detail}</Text>
      ) : null}
      {kind === 'error' && onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try again"
          onPress={onRetry}
          className="mt-2 min-h-[44px] justify-center rounded-btn border border-stroke px-5"
        >
          <Text className="font-inter-semibold text-[14px] text-ink">Try again</Text>
        </Pressable>
      ) : null}
    </View>
  )
}
