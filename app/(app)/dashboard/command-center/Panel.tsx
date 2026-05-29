'use client'

import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Shared compact panel chrome for the Command Center. Header is a single dense
 * row (icon + title + optional right-aligned slot); body holds the content.
 * Never nests cards — children are plain content.
 */
export function Panel({
  icon: Icon,
  title,
  right,
  children,
  className,
}: {
  icon?: LucideIcon
  title: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-xl border border-white/10 bg-white/5 p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{title}</span>
        </h2>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      {children}
    </section>
  )
}
