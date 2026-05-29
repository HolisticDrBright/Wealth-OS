'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, TrendingUp, Settings, LogOut, ChevronRight, ChevronDown,
  DollarSign, Users, Zap, Activity, Lightbulb, ShieldAlert, Bell, RefreshCw,
  PiggyBank, ShoppingCart, BarChart2, Bitcoin, Globe, Scale, ListChecks, Leaf,
  Store, FlaskConical, Home, Briefcase, Layers, Sigma, Brain, Wallet, Target,
  FileText, CandlestickChart, Crosshair, Ghost, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Navigation model ───────────────────────────────────────────────────────
// Seven top-level areas (Command Center, Portfolio, Opportunities, Strategies,
// Risk Room, Learning, Settings) plus a Markets group. Secondary routes are
// nested under collapsible sections so the rail stays uncluttered — every
// existing route remains reachable.

interface NavLeaf { href: string; label: string; icon: LucideIcon }
interface NavGroup { label: string; icon: LucideIcon; href?: string; children: NavLeaf[] }
type NavNode = NavLeaf | NavGroup

function isGroup(n: NavNode): n is NavGroup {
  return (n as NavGroup).children !== undefined
}

const NAV: NavNode[] = [
  { href: '/dashboard', label: 'Command Center', icon: LayoutDashboard },
  {
    label: 'Portfolio', icon: TrendingUp, href: '/portfolio',
    children: [
      { href: '/budget', label: 'Budget', icon: Wallet },
      { href: '/planning', label: 'Wealth Planning', icon: Target },
      { href: '/rebalance', label: 'Rebalance', icon: RefreshCw },
      { href: '/retirement', label: 'Retirement', icon: PiggyBank },
      { href: '/tax', label: 'Tax Advisor', icon: FileText },
      { href: '/tax/harvest', label: 'Tax Harvest', icon: Leaf },
      { href: '/household', label: 'Family Office', icon: Home },
      { href: '/advisor', label: 'Advisor', icon: Briefcase },
      { href: '/sleeves', label: 'Sleeves', icon: Layers },
    ],
  },
  {
    label: 'Opportunities', icon: Lightbulb, href: '/opportunities',
    children: [
      { href: '/orders', label: 'Orders', icon: ShoppingCart },
      { href: '/traders', label: 'Top Traders', icon: Users },
      { href: '/marketplace', label: 'Marketplace', icon: Store },
      { href: '/feed', label: 'Live Feed', icon: Activity },
    ],
  },
  {
    label: 'Strategies', icon: BarChart2, href: '/strategies',
    children: [
      { href: '/backtests', label: 'Backtests', icon: FlaskConical },
      { href: '/shadow-portfolio', label: 'Shadow Portfolio', icon: Ghost },
      { href: '/autopilot', label: 'Autopilot', icon: Zap },
      { href: '/autopilot/rules', label: 'Rules', icon: ListChecks },
    ],
  },
  {
    label: 'Markets', icon: CandlestickChart,
    children: [
      { href: '/stocks', label: 'Stocks', icon: TrendingUp },
      { href: '/options', label: 'Options', icon: Sigma },
      { href: '/crypto', label: 'Crypto', icon: Bitcoin },
      { href: '/forex', label: 'Forex', icon: Globe },
      { href: '/polymarket', label: 'Polymarket', icon: Scale },
    ],
  },
  { href: '/risk', label: 'Risk Room', icon: ShieldAlert },
  {
    label: 'Learning', icon: Brain, href: '/learning',
    children: [
      { href: '/calibration', label: 'Calibration', icon: Crosshair },
    ],
  },
  { href: '/alerts', label: 'Alerts', icon: Bell },
]

const ACTIVE_STYLE = {
  background: 'color-mix(in oklch, var(--color-accent-cyan) 8%, transparent)',
  boxShadow: 'inset 3px 0 0 var(--color-accent-cyan), 0 0 12px color-mix(in oklch, var(--color-accent-cyan) 20%, transparent)',
} as const

function pathActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}

export function Sidebar() {
  const pathname = usePathname()

  // A group starts expanded when it contains (or is) the active route.
  const groupContainsActive = (g: NavGroup) =>
    (g.href ? pathActive(pathname, g.href) : false) ||
    g.children.some(c => pathActive(pathname, c.href))

  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const n of NAV) if (isGroup(n)) init[n.label] = groupContainsActive(n)
    return init
  })

  const toggle = (label: string) => setOpen(o => ({ ...o, [label]: !o[label] }))

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-white/10 bg-[#0a0b0f]">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-white/10">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600">
          <DollarSign className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">Wealth OS</p>
          <p className="truncate text-xs text-gray-500">Capital Command Center</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {NAV.map(node => {
          if (!isGroup(node)) {
            const active = pathActive(pathname, node.href)
            return <TopLink key={node.href} href={node.href} label={node.label} icon={node.icon} active={active} />
          }

          const expanded = open[node.label] ?? false
          const selfActive = node.href ? pathActive(pathname, node.href) : false
          const Icon = node.icon

          return (
            <div key={node.label}>
              {/* Group header: navigates if it has an href; chevron toggles children. */}
              <div
                className={cn(
                  'group flex items-center rounded-lg text-sm font-medium transition-all',
                  selfActive ? 'text-accent-cyan' : 'text-gray-400 hover:bg-white/5 hover:text-white',
                )}
                style={selfActive ? ACTIVE_STYLE : undefined}
              >
                {node.href ? (
                  <Link href={node.href} className="flex flex-1 items-center gap-3 px-3 py-2.5">
                    <Icon className={cn('h-4 w-4 shrink-0', selfActive ? 'text-accent-cyan' : 'text-gray-500 group-hover:text-white')} />
                    <span className="truncate">{node.label}</span>
                  </Link>
                ) : (
                  <button onClick={() => toggle(node.label)} className="flex flex-1 items-center gap-3 px-3 py-2.5 text-left">
                    <Icon className="h-4 w-4 shrink-0 text-gray-500 group-hover:text-white" />
                    <span className="truncate">{node.label}</span>
                  </button>
                )}
                <button
                  onClick={() => toggle(node.label)}
                  aria-label={expanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
                  className="px-2 py-2.5 text-gray-600 hover:text-white"
                >
                  {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              </div>

              {/* Children */}
              {expanded && (
                <div className="mt-0.5 ml-4 space-y-0.5 border-l border-white/10 pl-2">
                  {node.children.map(child => {
                    const active = pathActive(pathname, child.href)
                    const ChildIcon = child.icon
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors',
                          active ? 'text-accent-cyan' : 'text-gray-500 hover:bg-white/5 hover:text-white',
                        )}
                      >
                        <ChildIcon className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-accent-cyan' : 'text-gray-600')} />
                        <span className="truncate">{child.label}</span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="space-y-0.5 border-t border-white/10 px-3 py-4">
        <FooterLink href="/settings" label="Settings" icon={Settings} />
        <FooterLink href="/settings/integrations" label="Integrations" icon={Settings} dim />
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 transition-all hover:bg-white/5 hover:text-red-400"
          >
            <LogOut className="h-4 w-4 text-gray-500" />
            Sign Out
          </button>
        </form>
      </div>
    </aside>
  )
}

function TopLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: LucideIcon; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
        active ? 'text-accent-cyan' : 'text-gray-400 hover:bg-white/5 hover:text-white',
      )}
      style={active ? ACTIVE_STYLE : undefined}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-accent-cyan' : 'text-gray-500 group-hover:text-white')} />
      <span className="truncate">{label}</span>
      {active && <ChevronRight className="ml-auto h-3 w-3 text-accent-cyan" />}
    </Link>
  )
}

function FooterLink({ href, label, icon: Icon, dim }: { href: string; label: string; icon: LucideIcon; dim?: boolean }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 transition-all hover:bg-white/5 hover:text-white"
    >
      <Icon className={cn('h-4 w-4 text-gray-500', dim && 'opacity-50')} />
      {label}
    </Link>
  )
}
