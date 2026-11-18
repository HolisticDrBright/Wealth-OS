/**
 * ▲/▼ next to every gain or loss figure (Phase 7.5) — so gains and losses are
 * never signalled by colour alone. Renders nothing for zero or missing
 * values. Screen readers hear "up"/"down" instead of the glyph's name.
 */

import { cn } from '@/lib/utils'

export function TrendArrow({ value, className }: {
  value: number | null | undefined
  className?: string
}) {
  if (value == null || !Number.isFinite(value) || value === 0) return null
  const up = value > 0
  return (
    <>
      <span aria-hidden className={cn('mr-0.5 inline-block', className)}>{up ? '▲' : '▼'}</span>
      <span className="sr-only">{up ? 'up ' : 'down '}</span>
    </>
  )
}
