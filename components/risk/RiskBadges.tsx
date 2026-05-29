/**
 * Reusable, compact risk badges so risk is legible everywhere — not just on
 * /risk. Each badge maps a level to the shared tone vocabulary and a lucide
 * icon. Keep them small (table cells, card footers) and never overflowing.
 */
import {
  Gauge, TrendingDown, Droplets, GitBranch, MapPin, Receipt, Crosshair,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { TONE_CLASSES, type Tone } from '@/lib/strategies/strategy-display'
import { type RiskLevel, brierToLevel, capUtilToLevel } from '@/lib/risk/levels'

export type { RiskLevel }
export { brierToLevel, capUtilToLevel }

const LEVEL_TONE: Record<RiskLevel, Tone> = {
  ok: 'positive',
  caution: 'caution',
  risk: 'danger',
  unknown: 'neutral',
}

interface RiskBadgeBaseProps {
  level: RiskLevel
  /** Short value/label, e.g. "8%", "High", "OK". Kept terse to avoid overflow. */
  value: string
  className?: string
  title?: string
}

function RiskBadge({
  icon: Icon, label, level, value, className, title,
}: RiskBadgeBaseProps & { icon: LucideIcon; label: string }) {
  const tone = TONE_CLASSES[LEVEL_TONE[level]]
  return (
    <span
      title={title ?? `${label}: ${value}`}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none',
        tone.text, tone.bg, tone.border, className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
      <span className="opacity-70">·</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  )
}

export const PositionCapBadge = (p: RiskBadgeBaseProps) =>
  <RiskBadge icon={Gauge} label="Cap" {...p} />

export const DrawdownBadge = (p: RiskBadgeBaseProps) =>
  <RiskBadge icon={TrendingDown} label="Drawdown" {...p} />

export const LiquidityBadge = (p: RiskBadgeBaseProps) =>
  <RiskBadge icon={Droplets} label="Liquidity" {...p} />

export const CorrelationBadge = (p: RiskBadgeBaseProps) =>
  <RiskBadge icon={GitBranch} label="Correlation" {...p} />

export const JurisdictionBadge = (p: RiskBadgeBaseProps) =>
  <RiskBadge icon={MapPin} label="Jurisdiction" {...p} />

export const TaxBadge = (p: RiskBadgeBaseProps) =>
  <RiskBadge icon={Receipt} label="Account" {...p} />

export const CalibrationBadge = (p: RiskBadgeBaseProps) =>
  <RiskBadge icon={Crosshair} label="Calibration" {...p} />
