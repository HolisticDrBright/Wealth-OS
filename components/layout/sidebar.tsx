'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  TrendingUp,
  Wallet,
  Target,
  FileText,
  Settings,
  LogOut,
  ChevronRight,
  DollarSign,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/portfolio', label: 'Portfolio', icon: TrendingUp },
  { href: '/budget', label: 'Budget', icon: Wallet },
  { href: '/planning', label: 'Wealth Planning', icon: Target },
  { href: '/tax', label: 'Tax Advisor', icon: FileText },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-white/10 bg-[#0a0b0f]">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-white/10">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600">
          <DollarSign className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-sm font-bold text-white">Wealth OS</p>
          <p className="text-xs text-gray-500">Financial Command Center</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                isActive
                  ? 'bg-indigo-600/20 text-indigo-400'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              )}
            >
              <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-indigo-400' : 'text-gray-500 group-hover:text-white')} />
              {label}
              {isActive && <ChevronRight className="ml-auto h-3 w-3 text-indigo-400" />}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 px-3 py-4 space-y-1">
        <Link
          href="/settings"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 hover:bg-white/5 hover:text-white transition-all"
        >
          <Settings className="h-4 w-4 text-gray-500" />
          Settings
        </Link>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 hover:bg-white/5 hover:text-red-400 transition-all"
          >
            <LogOut className="h-4 w-4 text-gray-500" />
            Sign Out
          </button>
        </form>
      </div>
    </aside>
  )
}
