import { cn } from '@/lib/utils'

interface ProgressProps {
  value: number
  max?: number
  className?: string
  barClassName?: string
}

export function Progress({ value, max = 100, className, barClassName }: ProgressProps) {
  const percentage = Math.min((value / max) * 100, 100)
  return (
    <div className={cn('h-2 w-full rounded-full bg-white/10', className)}>
      <div
        className={cn('h-full rounded-full transition-all duration-500', barClassName ?? 'bg-indigo-500')}
        style={{ width: `${percentage}%` }}
      />
    </div>
  )
}
