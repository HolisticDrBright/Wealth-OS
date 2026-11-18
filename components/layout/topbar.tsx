'use client'

/**
 * Page topbar. The bell links to /alerts and shows a badge only when there
 * are unread alerts; the avatar shows the signed-in user's initials and links
 * to Settings. (The old search button had no feature behind it and was
 * removed.)
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import type { ReactNode } from 'react'
import { getTopbarInfo, type TopbarInfo } from '@/lib/actions/topbar'

interface TopbarProps {
  title: string
  subtitle?: string
  badge?: ReactNode
}

export function Topbar({ title, subtitle, badge }: TopbarProps) {
  const [info, setInfo] = useState<TopbarInfo | null>(null)

  useEffect(() => {
    let alive = true
    getTopbarInfo().then(i => { if (alive) setInfo(i) }).catch(() => {})
    return () => { alive = false }
  }, [])

  const unread = info?.unreadAlerts ?? 0
  const bellLabel = unread > 0
    ? `Alerts, ${unread} unread`
    : 'Alerts'

  return (
    <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line-strong px-6 py-3">
      <div className="flex min-w-0 items-center gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-text-0">{title}</h1>
          {subtitle && <p className="text-xs text-text-2">{subtitle}</p>}
        </div>
        {badge}
      </div>
      <div className="flex items-center gap-3">
        <Link
          href="/alerts"
          aria-label={bellLabel}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong text-text-1 transition-colors hover:bg-white/5 hover:text-text-0"
        >
          <Bell className="h-4 w-4" aria-hidden />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-cyan px-1 text-[12px] font-bold leading-none text-bg-0"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Link>
        {info && (
          <Link
            href="/settings"
            aria-label={`Account settings for ${info.displayName}`}
            title={info.displayName}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-cyan text-sm font-semibold text-bg-0 transition hover:brightness-110"
          >
            {info.initials}
          </Link>
        )}
      </div>
    </header>
  )
}
