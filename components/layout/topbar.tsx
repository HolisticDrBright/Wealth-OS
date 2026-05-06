'use client'

import { Bell, Search } from 'lucide-react'
import type { ReactNode } from 'react'

interface TopbarProps {
  title: string
  subtitle?: string
  badge?: ReactNode
}

export function Topbar({ title, subtitle, badge }: TopbarProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-white/10 px-6">
      <div className="flex items-center gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">{title}</h1>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
        {badge}
      </div>
      <div className="flex items-center gap-3">
        <button className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
          <Search className="h-4 w-4" />
        </button>
        <button className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-indigo-500" />
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white text-sm font-semibold">
          W
        </div>
      </div>
    </header>
  )
}
