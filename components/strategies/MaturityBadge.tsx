import { cn } from '@/lib/utils'
import { getMaturityMeta, TONE_CLASSES } from '@/lib/strategies/strategy-display'
import type { StrategyMaturityStatus } from '@/lib/strategies/strategy-registry'

interface MaturityBadgeProps {
  status: StrategyMaturityStatus | string | null | undefined
  /** Show a leading status dot. Default true. */
  withDot?: boolean
  className?: string
  title?: string
}

/**
 * Compact, color-coded maturity pill. Planned/Retired read as clearly
 * non-tradable (muted slate / red), never as actionable green.
 */
export function MaturityBadge({ status, withDot = true, className, title }: MaturityBadgeProps) {
  const meta = getMaturityMeta(status)
  const tone = TONE_CLASSES[meta.tone]
  return (
    <span
      title={title ?? meta.description}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        tone.text, tone.bg, tone.border,
        className,
      )}
    >
      {withDot && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} />}
      {meta.label}
    </span>
  )
}
